import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { wechatLoginSchema, loginByWechat } from "@/server/identity";
import { clientIp } from "@/server/platform/security/login-guard";
import { hitRateLimit } from "@/server/platform/security/rate-limit";

export const runtime = "nodejs";

/** POST /api/auth/wechat/login —— {code, profile?} 一键登录：已绑定发会话；未绑定自动建号（免绑手机号） */
export const POST = withSchema(wechatLoginSchema, async (req: NextRequest, { valid }) => {
  // IP 层限流：本端点是唯一无认证即可触发出站调用（jscode2session）的入口，与 sms-send 同型设防
  const ip = clientIp(req);
  const rl = hitRateLimit(`wechat-login:ip:${ip}`, 15 * 60_000, 30);
  if (rl.blocked) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  return NextResponse.json(
    await loginByWechat({ code: valid.code, profile: valid.profile, userAgent: req.headers.get("user-agent") }),
  );
});
