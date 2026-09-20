import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/billing/users —— 管理员：全部用户套餐与近 30 天 AI 用量 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.id !== DEV_USER_ID) {
    return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });
  }
  const { rows } = await pool.query(
    `select p.id, p.nickname, p.phone, p.plan, p.plan_expires_at, p.created_at,
            (select count(*)::int from audit_logs a
              where a.user_id = p.id and a.created_at > now() - interval '30 days') as used_30d
     from profiles p
     order by p.created_at asc`,
  );
  return NextResponse.json({
    users: rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      phone: r.phone,
      plan: r.plan,
      planExpiresAt: r.plan_expires_at,
      createdAt: r.created_at,
      used30d: Number(r.used_30d ?? 0),
    })),
  });
}
