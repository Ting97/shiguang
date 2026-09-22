import { NextRequest, NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashPassword, isValidPhone } from "@/lib/auth-crypto";

export const runtime = "nodejs";

/**
 * POST /api/auth/setup —— 初始化管理员：仅当还没有任何绑定手机号的账号时可用；继承开发用户 UUID，存量数据零迁移。
 * 4-B（FR-C2.3 / T4 抢占防护）：服务器 .env 配置 SETUP_TOKEN 后必须携带（header x-setup-token）；
 * 该令牌被使用过一次（无论成败）即永久失效（app_config 键 setup_token_used）。
 */
export async function POST(req: NextRequest) {
  if (process.env.AUTH_DISABLED === "1") {
    return NextResponse.json({ error: "本机已开启 AUTH_DISABLED，无需初始化" }, { status: 400 });
  }
  const expect = process.env.SETUP_TOKEN;
  if (expect) {
    const { rows: used } = await pool.query(
      `select value from app_config where key = 'setup_token_used'`,
      [],
    );
    if (used[0]) {
      return NextResponse.json({ error: "初始化令牌已失效" }, { status: 410 });
    }
    const got = req.headers.get("x-setup-token") ?? String((await req.json().catch(() => ({})))?.setupToken ?? "");
    if (got !== expect) {
      // 计一次失败消费（防爆破令牌）；与一次性语义一致
      await consumeSetupToken();
      return NextResponse.json({ error: "初始化令牌不正确（已作废）" }, { status: 403 });
    }
    await consumeSetupToken();
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

async function consumeSetupToken() {
  await pool.query(
    `insert into app_config (key, value) values ('setup_token_used', to_jsonb(now()))
     on conflict (key) do nothing`,
  );
}
