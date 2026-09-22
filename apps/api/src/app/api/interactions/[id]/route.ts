import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { INTERACTION_TYPES } from "@shiguangri/shared/social";

export const runtime = "nodejs";

/** PATCH /api/interactions/:id —— 修正往来记录（type/summary/occurredAt；QA 验收补齐） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    summary?: string | null;
    occurredAt?: string;
  };

  const vals: unknown[] = [];
  const sets: string[] = [];
  if (body.type !== undefined) {
    if (!(INTERACTION_TYPES as readonly string[]).includes(body.type)) {
      return NextResponse.json({ error: "无效的往来类型" }, { status: 400 });
    }
    vals.push(body.type);
    sets.push(`type = $${vals.length}`);
  }
  if (body.summary !== undefined) {
    vals.push(body.summary?.trim() || null);
    sets.push(`summary = $${vals.length}`);
  }
  if (body.occurredAt !== undefined) {
    const t = new Date(body.occurredAt);
    if (isNaN(t.getTime())) return NextResponse.json({ error: "时间格式不正确" }, { status: 400 });
    vals.push(t.toISOString());
    sets.push(`occurred_at = $${vals.length}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  const updated = (
    await pool.query(
      `update interactions set ${sets.join(", ")} where id = $${vals.length + 1} and user_id = $${vals.length + 2} returning *`,
      [...vals, id, user.id],
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "往来记录不存在" }, { status: 404 });
  return NextResponse.json({ interaction: updated });
}

/** DELETE /api/interactions/:id —— 删除识别错的人际往来关联（不动联系人档案本身） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(
      `delete from interactions where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "往来记录不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
