import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateInviteCode } from "@/lib/auth-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/invites —— 管理员查看邀请码（最近 50 个） */
export async function GET() {
  const adminErr = await requireAdmin();
  if (adminErr) return adminErr;
  const { rows } = await pool.query(
    `select i.code, i.used_by, i.expires_at, i.created_at, p.nickname as used_by_name
     from invite_codes i left join profiles p on p.id = i.used_by
     order by i.created_at desc limit 50`,
  );
  return NextResponse.json({ invites: rows });
}

/** POST /api/auth/invites —— 管理员生成邀请码 {days?: 7} */
export async function POST(req: Request) {
  const adminErr = await requireAdmin();
  if (adminErr) return adminErr;
  const { days = 7 } = (await req.json().catch(() => ({}))) as { days?: number };
  const code = generateInviteCode();
  const expires = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
  const { rows } = await pool.query(
    `insert into invite_codes (code, created_by, expires_at) values ($1,$2,$3) returning code, expires_at`,
    [code, DEV_USER_ID, expires],
  );
  return NextResponse.json({ ok: true, invite: rows[0] });
}

/** 管理员 = 初始化账号（继承开发用户 UUID）；未登录 401，非管理员 403 */
async function requireAdmin(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.id !== DEV_USER_ID) {
    return NextResponse.json({ error: "仅管理员可管理邀请码" }, { status: 403 });
  }
  return null;
}
