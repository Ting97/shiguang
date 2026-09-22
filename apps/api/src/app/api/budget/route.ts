import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/budget —— 月度上限配置 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows } = await pool.query(
    `select monthly_limit_cents, alert_threshold from budgets where user_id = $1`,
    [user.id],
  );
  return NextResponse.json({
    budget: rows[0] ?? { monthly_limit_cents: 0, alert_threshold: 80 },
  });
}

/** PUT /api/budget —— 保存月度上限 {monthlyLimitCents, alertThreshold?} */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    monthlyLimitCents?: number;
    alertThreshold?: number;
  };
  if (!Number.isInteger(body.monthlyLimitCents) || (body.monthlyLimitCents ?? 0) < 0) {
    return NextResponse.json({ error: "上限需为非负整数（分，0=不设上限）" }, { status: 400 });
  }
  const threshold = Math.min(Math.max(body.alertThreshold ?? 80, 1), 100);
  const { rows } = await pool.query(
    `insert into budgets (user_id, monthly_limit_cents, alert_threshold)
     values ($1, $2, $3)
     on conflict (user_id) do update
       set monthly_limit_cents = $2, alert_threshold = $3, updated_at = now()
     returning monthly_limit_cents, alert_threshold`,
    [user.id, body.monthlyLimitCents, threshold],
  );
  return NextResponse.json({ budget: rows[0] });
}
