import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { generateInviteCode } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requireAdmin = (role: string) => {
  if (role !== "admin") throw ApiError.forbidden("仅管理员可管理邀请码");
};

/** GET /api/admin/invites —— 管理员查看邀请码（最近 50 个；自 auth/invites 迁移，旧地址保留别名） */
export const GET = withAuth(async (_req, { user }) => {
  requireAdmin(user.role);
  const { rows } = await pool.query(
    `select i.code, i.used_by, i.expires_at, i.created_at, p.nickname as used_by_name
     from invite_codes i left join profiles p on p.id = i.used_by
     order by i.created_at desc limit 50`,
  );
  return NextResponse.json({ invites: rows });
});

/** POST /api/admin/invites {days?: 7} —— 管理员生成邀请码 */
export const POST = withAuth(async (req, { user }) => {
  requireAdmin(user.role);
  const { days = 7 } = (await req.json().catch(() => ({}))) as { days?: number };
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw ApiError.badRequest("days 需为 1~365 的整数");
  }
  const code = generateInviteCode();
  const expires = new Date(Date.now() + days * 86_400_000);
  const { rows } = await pool.query(
    `insert into invite_codes (code, created_by, expires_at) values ($1,$2,$3) returning code, expires_at`,
    [code, user.id, expires],
  );
  return NextResponse.json({ ok: true, invite: rows[0] });
});
