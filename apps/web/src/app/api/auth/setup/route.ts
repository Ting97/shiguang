import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashPassword, isValidPhone } from "@/lib/auth-crypto";

export const runtime = "nodejs";

/** POST /api/auth/setup —— 初始化管理员：仅当还没有任何绑定手机号的账号时可用；继承开发用户 UUID，存量数据零迁移 */
export async function POST(req: Request) {
  if (process.env.AUTH_DISABLED === "1") {
    return NextResponse.json({ error: "本机已开启 AUTH_DISABLED，无需初始化" }, { status: 400 });
  }
  const { nickname, phone, password } = (await req.json().catch(() => ({}))) as {
    nickname?: string; phone?: string; password?: string;
  };

  if (!nickname?.trim() || !phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: "请填写昵称和正确的手机号" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  const existing = await pool.query(`select 1 from profiles where phone is not null limit 1`);
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: "管理员已存在，请直接登录" }, { status: 403 });
  }

  const { rows } = await pool.query(
    `update profiles set nickname = $1, phone = $2, phone_verified = true,
       password_hash = $3, last_login_at = now()
     where id = $4 returning id, nickname, phone`,
    [nickname.trim(), phone, hashPassword(password), DEV_USER_ID],
  );
  if (!rows[0]) return NextResponse.json({ error: "初始化失败" }, { status: 500 });

  const token = await createSession(rows[0].id, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true, token, user: rows[0] });
}
