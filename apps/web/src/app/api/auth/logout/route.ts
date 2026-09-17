import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/auth/logout —— 退出登录（删会话 + 清 cookie） */
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
