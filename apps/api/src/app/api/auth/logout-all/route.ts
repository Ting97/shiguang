import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser, destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout-all —— 全端登出（REQ-004 FR-C1.3）：吊销该用户全部会话并清本机 cookie */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  await pool.query(`delete from sessions where user_id = $1`, [user.id]);
  await destroySession(); // 清当前 cookie（会话行已随上面删除）
  return NextResponse.json({ ok: true });
}
