import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

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
