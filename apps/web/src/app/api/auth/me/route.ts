import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pool, DEV_USER_ID } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me —— 当前会话信息；未登录 401 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows } = await pool.query(
    `select created_at, phone_verified from profiles where id = $1`,
    [user.id],
  );
  return NextResponse.json({
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    authDisabled: process.env.AUTH_DISABLED === "1",
    isAdmin: user.id === DEV_USER_ID, // 管理员 = 初始化账号（继承开发用户 UUID）
    phoneVerified: rows[0]?.phone_verified ?? false,
    createdAt: rows[0]?.created_at ?? null,
  });
}
