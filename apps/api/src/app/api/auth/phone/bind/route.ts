import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { bindPhoneBySession } from "@/server/identity";

export const runtime = "nodejs";

/**
 * POST /api/auth/phone/bind —— 已登录账号绑定手机号（微信一键登录建的号补绑手机，
 * 之后可用手机号+密码登录网页版；密码走「我的 → 修改密码」设置）。
 * body: { phone, smsCode }（验证码 purpose=bind，先发 /api/auth/sms/send）
 */
export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown; smsCode?: unknown };
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const smsCode = typeof body.smsCode === "string" ? body.smsCode.trim() : "";
  if (!phone || !smsCode) {
    return NextResponse.json({ error: "请填写手机号和验证码", code: "invalid_input" }, { status: 400 });
  }
  return NextResponse.json(await bindPhoneBySession({ userId: user.id, phone, smsCode }));
});
