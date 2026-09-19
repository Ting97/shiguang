import { NextResponse } from "next/server";
import { isValidPhone } from "@/lib/auth-crypto";
import { sendSmsCode } from "@/lib/sms";

export const runtime = "nodejs";

/** POST /api/auth/sms/send —— {phone, purpose?} 发送验证码；同号 60s/次、日 10 条 */
export async function POST(req: Request) {
  const { phone, purpose = "login" } = (await req.json().catch(() => ({}))) as {
    phone?: string; purpose?: "login" | "bind";
  };
  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: "请填写正确的手机号" }, { status: 400 });
  }
  if (!["login", "bind"].includes(purpose)) {
    return NextResponse.json({ error: "不支持的用途" }, { status: 400 });
  }
  const r = await sendSmsCode(phone, purpose);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
