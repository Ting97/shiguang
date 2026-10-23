import { NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { z } from "zod";
import { sendSms } from "@/server/identity";
import { clientIp } from "@/server/platform/security/login-guard";
import { hitRateLimit } from "@/server/platform/security/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  // E.164 上限 15 位：超长串直插 sms_codes 是未认证滥用面（二十轮，对齐 email max 254）
  phone: z.string().max(24).optional(),
  purpose: z.enum(["login", "bind"]).default("login"),
});

/** POST /api/auth/sms/send —— {phone, purpose?} 发送验证码；同号 60s/次、日 10 条 */
export const POST = withSchema(schema, async (req, { valid }) => {
  // IP 层限流：身份（号码/邮箱）维度之外的第二层——否则持号码字典可对各号各打满日额度，形成短信/邮件轰炸
  const ip = clientIp(req);
  const rl = hitRateLimit(`otp-send:ip:${ip}`, 15 * 60_000, 20);
  if (rl.blocked) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  return NextResponse.json(await sendSms(valid));
});
