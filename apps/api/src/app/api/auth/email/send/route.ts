import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/email";
import { sendEmailCode } from "@/lib/email";

export const runtime = "nodejs";

/** POST /api/auth/email/send —— {email, purpose?} 发送邮箱验证码；同邮箱 60s/次、日 10 条 */
export async function POST(req: Request) {
  const { email, purpose = "login" } = (await req.json().catch(() => ({}))) as {
    email?: string; purpose?: "login" | "bind";
  };
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "请填写正确的邮箱地址" }, { status: 400 });
  }
  if (!["login", "bind"].includes(purpose)) {
    return NextResponse.json({ error: "不支持的用途" }, { status: 400 });
  }
  const r = await sendEmailCode(email.trim().toLowerCase(), purpose);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
