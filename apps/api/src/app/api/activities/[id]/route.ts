import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    color?: string;
    defaultMin?: number;
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name != null) { vals.push(body.name.trim()); sets.push(`name = $${vals.length}`); }
  if (body.icon != null) { vals.push(body.icon.trim() || "🏷"); sets.push(`icon = $${vals.length}`); }
  if (body.color != null && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    vals.push(body.color); sets.push(`color = $${vals.length}`);
  }
  if (body.defaultMin != null) {
    vals.push(Math.min(Math.max(body.defaultMin, 5), 720));
    sets.push(`default_min = $${vals.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  vals.push(id, user.id);

  try {
    const updated = (
      await pool.query(
        `update activities set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
        vals,
      )
    ).rows[0];
    if (!updated) return NextResponse.json({ error: "分类不存在" }, { status: 404 });
    return NextResponse.json({ activity: updated });
  } catch (e) {
    if (String(e).includes("activities_user_id_name_key")) {
      return NextResponse.json({ error: "已存在同名分类" }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const act = (
      await client.query(
        `select * from activities where id = $1 and user_id = $2`,
        [id, user.id],
      )
    ).rows[0];
    if (!act) {
      await client.query("rollback");
      return NextResponse.json({ error: "分类不存在" }, { status: 404 });
    }
    if (act.is_preset) {
      await client.query("rollback");
      return NextResponse.json({ error: "预设分类不可删除（可修改名称/图标/颜色）" }, { status: 400 });
    }
    await client.query(`update time_blocks set activity_id = 'other' where activity_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`update todos set activity_id = 'other' where activity_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from activities where id = $1 and user_id = $2`, [id, user.id]);
    await client.query("commit");
    return NextResponse.json({ ok: true, reassigned: true });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
