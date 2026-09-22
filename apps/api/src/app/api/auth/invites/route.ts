import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getAdminUser } from "@/server/identity/auth";
import { generateInviteCode } from "@/server/identity/auth-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/invites —— 管理员查看邀请码（最近 50 个） */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "仅管理员可管理邀请码" }, { status: 403 });
  const { rows } = await pool.query(
    `select i.code, i.used_by, i.expires_at, i.created_at, p.nickname as used_by_name
     from invite_codes i left join profiles p on p.id = i.used_by
     order by i.created_at desc limit 50`,
  );
  return NextResponse.json({ invites: rows });
}

/** POST /api/auth/invites —— 管理员生成邀请码 {days?: 7} */
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "仅管理员可管理邀请码" }, { status: 403 });
  const { days = 7 } = (await req.json().catch(() => ({}))) as { days?: number };
  const code = generateInviteCode();
  const expires = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
  const { rows } = await pool.query(
    `insert into invite_codes (code, created_by, expires_at) values ($1,$2,$3) returning code, expires_at`,
    [code, admin.id, expires],
  );
  return NextResponse.json({ ok: true, invite: rows[0] });
}
