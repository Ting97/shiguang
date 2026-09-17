import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me —— 当前会话信息；未登录 401 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    authDisabled: process.env.AUTH_DISABLED === "1",
  });
}
