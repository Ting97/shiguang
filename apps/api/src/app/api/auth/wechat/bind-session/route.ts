import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { bindSessionByWechat } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/wechat/bind-session —— 已登录账号绑定当前微信（密码登录后凭 code 迁移 openid；空壳回收语义见 wechat.ts） */
export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 512) {
    return NextResponse.json({ error: "code 无效", code: "invalid_input" }, { status: 400 });
  }
  return NextResponse.json(
    await bindSessionByWechat({ code, userId: user.id, userAgent: req.headers.get("user-agent") }),
  );
});
