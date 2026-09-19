import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashPassword, isValidPhone } from "@/lib/auth-crypto";
import { smsConfigured, verifySmsCode } from "@/lib/sms";
import { seedPresetActivities } from "@/lib/seed";

export const runtime = "nodejs";

/** POST /api/auth/register —— 邀请码注册 {phone, password, inviteCode, smsCode?}；SMS 通道未开通时邀请码即凭证 */
export async function POST(req: Request) {
  const { phone, password, inviteCode, smsCode } = (await req.json().catch(() => ({}))) as {
    phone?: string; password?: string; inviteCode?: string; smsCode?: string;
  };

  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: "请填写正确的手机号" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  if (!inviteCode?.trim()) {
    return NextResponse.json({ error: "请填写邀请码" }, { status: 400 });
  }

  const invite = await pool.query(
    `select code from invite_codes
     where code = $1 and used_by is null and (expires_at is null or expires_at > now())`,
    [inviteCode.trim().toUpperCase()],
  );
  if (invite.rows.length === 0) {
    return NextResponse.json({ error: "邀请码无效或已被使用" }, { status: 400 });
  }

  const dup = await pool.query(`select 1 from profiles where phone = $1`, [phone]);
  if (dup.rows.length > 0) {
    return NextResponse.json({ error: "该手机号已注册，请直接登录" }, { status: 400 });
  }

  // 短信通道开通后注册必须验证手机号；未开通时邀请码即凭证（管理员可控）
  let phoneVerified = false;
  if (smsConfigured()) {
    if (!smsCode) return NextResponse.json({ error: "请填写短信验证码" }, { status: 400 });
    if (!(await verifySmsCode(phone, "login", smsCode))) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 });
    }
    phoneVerified = true;
  }

  const { rows } = await pool.query(
    `insert into profiles (nickname, phone, phone_verified, password_hash, last_login_at)
     values ($1, $2, $3, $4, now()) returning id, nickname`,
    [`用户${phone.slice(-4)}`, phone, phoneVerified, hashPassword(password)],
  );
  const user = rows[0];
  await seedPresetActivities(user.id); // 九大预设分类：新用户开箱即用

  await pool.query(`update invite_codes set used_by = $1, used_at = now() where code = $2`, [
    user.id, inviteCode.trim().toUpperCase(),
  ]);
  const token = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, token, user });
}
