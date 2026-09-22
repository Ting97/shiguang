import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** PATCH /api/blocks/:id —— 修改时间块（标题/起止时间/类别）；新时间段不得与其他块重叠 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    startAt?: string; // ISO
    endAt?: string; // ISO
    activityId?: string;
  };

  // 重叠校验：新起止与现有块（排除自身）
  const cur = (
    await pool.query(`select start_at, end_at from time_blocks where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!cur) return NextResponse.json({ error: "日程不存在" }, { status: 404 });
  const newStart = body.startAt ?? cur.start_at;
  const newEnd = body.endAt ?? cur.end_at;
  const conflict = await findOverlap(user.id, newStart, newEnd, id);
  if (conflict) {
    return NextResponse.json({ error: overlapError(conflict), conflict }, { status: 409 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.title != null) { vals.push(body.title.trim()); sets.push(`title = $${vals.length}`); }
  if (body.startAt != null) { vals.push(body.startAt); sets.push(`start_at = $${vals.length}`); }
  if (body.endAt != null) { vals.push(body.endAt); sets.push(`end_at = $${vals.length}`); }
  if (body.activityId != null) { vals.push(body.activityId); sets.push(`activity_id = $${vals.length}`); }
  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  vals.push(id, user.id);

  try {
    const updated = (
      await pool.query(
        `update time_blocks set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length}
         returning *`,
        vals,
      )
    ).rows[0];
    if (!updated) return NextResponse.json({ error: "日程不存在" }, { status: 404 });
    return NextResponse.json({ block: updated });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("time_blocks_check") || msg.includes("end_at_start_at")) {
      return NextResponse.json({ error: "结束时间必须晚于开始时间" }, { status: 400 });
    }
    if (msg.includes("time_blocks_activity_id_fkey")) {
      return NextResponse.json({ error: "类别不存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/blocks/:id —— 删除时间块 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(
      `delete from time_blocks where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "日程不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
