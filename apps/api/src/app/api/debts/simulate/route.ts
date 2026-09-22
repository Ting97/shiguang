import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { getModuleUser } from "@/server/platform/modules";
import { simulateStrategy, type SimDebt } from "@/server/finance/debt/debts-sim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/debts/simulate {extraMonthlyCents} —— 雪球 vs 雪崩并排模拟（FR-C2.6）
 * 基线 = 仅按各笔最低月供（额外 0）；节省额相对基线。模拟估算，仅供参考。 */
export async function POST(req: Request) {
  const user = await getModuleUser("debt");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通负债管理模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { extraMonthlyCents?: number };
  const extra = body.extraMonthlyCents ?? 0;
  if (!Number.isInteger(extra) || extra < 0 || extra > 100_000_000) {
    return NextResponse.json({ error: "每月额外还款需为 0~100 万的整数（分）" }, { status: 400 });
  }

  const { rows } = await pool.query(
    `select id, name, balance_cents, rate_pct::float8 as rate_pct, monthly_cents
     from liabilities where user_id = $1 and status = 'active' and balance_cents > 0`,
    [user.id],
  );
  const debts: SimDebt[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    balanceCents: Number(r.balance_cents),
    ratePct: Number(r.rate_pct),
    monthlyCents: r.monthly_cents === null ? null : Number(r.monthly_cents),
  }));
  if (debts.length === 0) {
    return NextResponse.json({ error: "没有进行中的负债，无需模拟" }, { status: 400 });
  }

  const startMonth = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
  const baseline = simulateStrategy(debts, 0, "baseline", startMonth);
  const snowball = simulateStrategy(debts, extra, "snowball", startMonth);
  const avalanche = simulateStrategy(debts, extra, "avalanche", startMonth);

  const pack = (r: ReturnType<typeof simulateStrategy>) => ({
    strategy: r.strategy,
    order: r.order,
    months: r.months,
    clearedLabel: r.clearedLabel,
    totalInterestCents: r.totalInterestCents,
    totalPaidCents: r.totalPaidCents,
    interestSavedVsBaselineCents: baseline.totalInterestCents - r.totalInterestCents,
    monthsSavedVsBaseline: baseline.months != null && r.months != null ? baseline.months - r.months : null,
    schedule: r.schedule,
    notCleared: r.notCleared,
  });

  return NextResponse.json({
    startMonth,
    debtsCount: debts.length,
    baseline: pack(baseline),
    snowball: pack(snowball),
    avalanche: pack(avalanche),
  });
}
