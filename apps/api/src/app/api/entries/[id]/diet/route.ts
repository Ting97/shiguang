import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** DELETE /api/entries/:id/diet —— 删除该动态的饮食记录（识别产物可单独删除） */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const { rowCount } = await pool.query(
    `delete from diet_records where entry_id = $1 and user_id = $2`,
    [id, user.id],
  );
  // 识别登记簿同步置"已删除"，避免统计/重识别状态与实际不符
  await pool.query(
    `update entry_recognitions set status = 'none', result = result || '{"reason": "用户已删除饮食记录"}'::jsonb
     where entry_id = $1 and user_id = $2 and domain = 'diet'`,
    [id, user.id],
  );
  if (!rowCount) return NextResponse.json({ error: "没有饮食记录" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
