import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { registerSchema, register } from "@/server/identity";
import { clientIp } from "@/server/platform/security/login-guard";
import { hitRateLimit } from "@/server/platform/security/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/auth/register —— 邀请码注册，双身份二选一（通道已配置时须验证码）
 */
export const POST = withSchema(registerSchema, async (req: NextRequest, { valid }) => {
  // IP 层限流：注册无成本校验（邀请码/身份占用探测仅 4 条查询且不受身份层锁约束），
  // 未认证端点不限流可被并行枚举邀请码与已注册手机号（与 otp-send 的 IP 层同型）
  const ip = clientIp(req);
  const rl = hitRateLimit(`register:ip:${ip}`, 15 * 60_000, 10);
  if (rl.blocked) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  return NextResponse.json(await register({ ...valid, userAgent: req.headers.get("user-agent") }));
});
