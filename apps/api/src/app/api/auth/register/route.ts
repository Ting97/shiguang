import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashPassword, isValidPhone } from "@/lib/auth-crypto";
import { emailConfigured, isValidEmail, verifyEmailCode } from "@/lib/email";
import { smsConfigured, verifySmsCode } from "@/lib/sms";
import { seedPresetActivities } from "@/lib/seed";

export const runtime = "nodejs";

/**
 * POST /api/auth/register —— 邀请码注册，双身份二选一：
 * {phone, password, inviteCode, smsCode?} 或 {email, password, inviteCode, emailCode?}
 * 通道已配置时必须验证码；未配置时邀请码即凭证（identity 标记未验证，密码登录不受影响）
 */
export async function POST(req: Request) {
  const { phone, email, password, inviteCode, smsCode, emailCode } = (await req.json().catch(() => ({}))) as {
    phone?: string; email?: string; password?: string; inviteCode?: string; smsCode?: string; emailCode?: string;
  };
  const byEmail = !phone && !!email;

  if (!byEmail && (!phone || !isValidPhone(phone))) {
    return NextResponse.json({ error: "请填写正确的手机号" }, { status: 400 });
  }
  if (byEmail && (!email || !isValidEmail(email))) {
    return NextResponse.json({ error: "请填写正确的邮箱地址" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  if (!inviteCode?.trim()) {
    return NextResponse.json({ error: "请填写邀请码" }, { status: 400 });
  }
  const emailNorm = byEmail ? email!.trim().toLowerCase() : null;

  const invite = await pool.query(
    `select code from invite_codes
     where code = $1 and used_by is null and (expires_at is null or expires_at > now())`,
    [inviteCode.trim().toUpperCase()],
  );
  if (invite.rows.length === 0) {
    return NextResponse.json({ error: "邀请码无效或已被使用" }, { status: 400 });
  }

  const dup = await pool.query(
    `select phone, email from profiles where phone = $1 or email = $2`,
    [byEmail ? null : phone, emailNorm],
  );
  if (dup.rows.length > 0) {
    const hit = byEmail ? dup.rows[0].email : dup.rows[0].phone;
    if (byEmail && hit) return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 400 });
    if (!byEmail && hit) return NextResponse.json({ error: "该手机号已注册，请直接登录" }, { status: 400 });
  }

  // 通道验证：已配置则必须验证码通过并标记已验证；未配置则邀请码即凭证（identity 标记未验证）
  let phoneVerified = false;
  let emailVerified = false;
  if (byEmail) {
    if (emailConfigured()) {
      if (!emailCode) return NextResponse.json({ error: "请填写邮箱验证码" }, { status: 400 });
      if (!(await verifyEmailCode(emailNorm!, "login", emailCode))) {
        return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 });
      }
      emailVerified = true;
    }
  } else if (smsConfigured()) {
    if (!smsCode) return NextResponse.json({ error: "请填写短信验证码" }, { status: 400 });
    if (!(await verifySmsCode(phone!, "login", smsCode))) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 });
    }
    phoneVerified = true;
  }

  const nickname = byEmail ? `用户${emailNorm!.split("@")[0].slice(-4)}` : `用户${phone!.slice(-4)}`;
  const { rows } = await pool.query(
    `insert into profiles (nickname, phone, email, phone_verified, email_verified, password_hash, last_login_at)
     values ($1, $2, $3, $4, $5, $6, now()) returning id, nickname`,
    [nickname, byEmail ? null : phone, emailNorm, phoneVerified, emailVerified, hashPassword(password)],
  );
  const user = rows[0];
  await seedPresetActivities(user.id); // 九大预设分类：新用户开箱即用

  await pool.query(`update invite_codes set used_by = $1, used_at = now() where code = $2`, [
    user.id, inviteCode.trim().toUpperCase(),
  ]);
  const token = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, token, user });
}
