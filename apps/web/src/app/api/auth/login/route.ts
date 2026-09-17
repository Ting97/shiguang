import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { verifyPassword, isValidPhone } from "@/lib/auth-crypto";
import { verifySmsCode } from "@/lib/sms";

export const runtime = "nodejs";

/** POST /api/auth/login —— {phone, password} 或 {phone, smsCode} 双模式 */
export async function POST(req: Request) {
  const { phone, password, smsCode } = (await req.json().catch(() => ({}))) as {
    phone?: string; password?: string; smsCode?: string;
  };
  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: "请填写正确的手机号" }, { status: 400 });
  }

  const { rows } = await pool.query(
    `select id, nickname, phone, phone_verified, password_hash from profiles where phone = $1`,
    [phone],
  );
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "账号不存在，请先注册" }, { status: 401 });

  if (password) {
    if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: "手机号或密码不正确" }, { status: 401 });
    }
  } else if (smsCode) {
    if (!user.phone_verified) {
      return NextResponse.json({ error: "该账号手机号未验证，请使用密码登录" }, { status: 403 });
    }
    if (!(await verifySmsCode(phone, "login", smsCode))) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 });
    }
  } else {
    return NextResponse.json({ error: "请填写密码或验证码" }, { status: 400 });
  }

  await pool.query(`update profiles set last_login_at = now() where id = $1`, [user.id]);
  await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, user: { id: user.id, nickname: user.nickname } });
}
