import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { verifyPassword, isValidPhone } from "@/lib/auth-crypto";
import { isValidEmail, verifyEmailCode } from "@/lib/email";
import { verifySmsCode } from "@/lib/sms";

export const runtime = "nodejs";

/**
 * POST /api/auth/login —— 双身份：{phone|email} + {password | smsCode | emailCode}
 * 手机号：密码 / 短信验证码；邮箱：密码 / 邮箱验证码（验证码登录需邮箱已验证）
 */
export async function POST(req: Request) {
  const { phone, email, password, smsCode, emailCode } = (await req.json().catch(() => ({}))) as {
    phone?: string; email?: string; password?: string; smsCode?: string; emailCode?: string;
  };
  const byEmail = !phone && !!email;
  if (!byEmail && (!phone || !isValidPhone(phone))) {
    return NextResponse.json({ error: "请填写正确的手机号" }, { status: 400 });
  }
  if (byEmail && (!email || !isValidEmail(email))) {
    return NextResponse.json({ error: "请填写正确的邮箱地址" }, { status: 400 });
  }
  const identity = byEmail ? email!.trim().toLowerCase() : phone!;

  const { rows } = await pool.query(
    byEmail
      ? `select id, nickname, phone, email, email_verified, password_hash from profiles where email = $1`
      : `select id, nickname, phone, email, email_verified, password_hash from profiles where phone = $1`,
    [identity],
  );
  const user = rows[0];
  if (!user) {
    return NextResponse.json(
      { error: byEmail ? "邮箱未注册，请先注册" : "账号不存在，请先注册" },
      { status: 401 },
    );
  }

  if (password) {
    if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: byEmail ? "邮箱或密码不正确" : "手机号或密码不正确" }, { status: 401 });
    }
  } else if (byEmail) {
    if (!user.email_verified) {
      return NextResponse.json({ error: "该邮箱未完成验证，请使用密码登录" }, { status: 403 });
    }
    if (!emailCode || !(await verifyEmailCode(identity, "login", emailCode))) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 });
    }
  } else {
    if (!user.phone_verified) {
      return NextResponse.json({ error: "该账号手机号未验证，请使用密码登录" }, { status: 403 });
    }
    if (!smsCode || !(await verifySmsCode(identity, "login", smsCode))) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 });
    }
  }

  await pool.query(`update profiles set last_login_at = now() where id = $1`, [user.id]);
  const token = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, token, user: { id: user.id, nickname: user.nickname } });
}
