import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { getModuleUser } from "@/server/platform/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";

/** GET /api/debts/overview —— 总览聚合（FR-C2.5）：
 * 总负债双口径/月供合计+到期提示/加权利率/净资产/到期墙（≤3月 danger、≤6月 warn）/现金流月视图 */
export async function GET() {
  const user = await getModuleUser("debt");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通负债管理模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }

  const active = (
    await pool.query(
      `select id, name, type, balance_cents, rate_pct::float8 as rate_pct, monthly_cents, due_date
       from liabilities where user_id = $1 and status = 'active'`,
      [user.id],
    )
  ).rows;

  const sum = (rows: typeof active, f: (r: (typeof active)[0]) => number) =>
    rows.reduce((s, r) => s + f(r), 0);

  const totalAll = sum(active, (r) => Number(r.balance_cents));
  const totalBank = sum(active.filter((r) => r.type !== "family"), (r) => Number(r.balance_cents));
  const monthlyDue = sum(active, (r) => Number(r.monthly_cents ?? 0));
  const weightedRate =
    totalAll > 0
      ? Math.round(
          (sum(active, (r) => Number(r.balance_cents) * Number(r.rate_pct)) / totalAll) * 100,
        ) / 100
      : 0;

  // 净资产 = 资产账户动态余额合计 − 总负债（含亲友口径）
  const assets = (
    await pool.query(
      `select coalesce(sum(a.opening_balance_cents + coalesce((
          select sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end)
          from transactions t where t.account_id = a.id and t.is_draft = false), 0)), 0)::bigint as balance
       from accounts a where a.user_id = $1 and a.archived = false`,
      [user.id],
    )
  ).rows[0];
  const assetBalance = Number(assets.balance);

  // 到期墙：未来 6 个月内到期（先息后本 = 本金到期节点）
  // 注意：node-pg 把 date 解析为 Date 对象（本地时区 00:00），先归一化为 YYYY-MM-DD 再计算
  const nowBj = new Date(Date.now() + 8 * 3600_000);
  const bjDayOf = (d: unknown): string =>
    d instanceof Date
      ? new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
      : String(d).slice(0, 10);
  const monthDiff = (dueMs: number) => {
    const due = new Date(dueMs);
    return (
      (due.getUTCFullYear() - nowBj.getUTCFullYear()) * 12 +
      (due.getUTCMonth() - nowBj.getUTCMonth())
    );
  };
  const todayBjMs = Date.parse(`${nowBj.toISOString().slice(0, 10)}T00:00:00Z`);
  const wall = active
    .filter((r) => r.due_date)
    .map((r) => ({ ...r, due: bjDayOf(r.due_date) }))
    .map((r) => ({ ...r, dm: monthDiff(Date.parse(`${r.due}T00:00:00Z`)) }))
    .filter((r) => r.dm >= 0 && r.dm <= 6)
    .sort((a, b) => a.dm - b.dm)
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      dueDate: r.due,
      balanceCents: Number(r.balance_cents),
      monthlyCents: r.monthly_cents === null ? null : Number(r.monthly_cents),
      daysLeft: Math.max(0, Math.round((Date.parse(`${r.due}T00:00:00Z`) - todayBjMs) / 86_400_000)),
      level: r.dm <= 3 ? "danger" : "warn",
    }));

  // 现金流月视图：本月真实收支 vs 月供应还（已关联记账的还款不重复扣）
  const monthKey = nowBj.toISOString().slice(0, 7);
  const cf = (
    await pool.query(
      `select
         coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
         coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out
       from transactions
       where user_id = $1 and is_draft = false
         and to_char(occurred_at at time zone $2, 'YYYY-MM') = $3`,
      [user.id, TZ, monthKey],
    )
  ).rows[0];
  const paidThisMonth = Number(
    (
      await pool.query(
        `select coalesce(sum(amount_cents), 0)::bigint as n from liability_payments
         where user_id = $1 and to_char(paid_at, 'YYYY-MM') = $2`,
        [user.id, monthKey],
      )
    ).rows[0].n,
  );
  const incomeCents = Number(cf.inc);
  const expenseCents = Number(cf.out);
  const realizedCents = incomeCents - expenseCents;
  const remainingDue = Math.max(0, monthlyDue - paidThisMonth);
  const gapCents = realizedCents - remainingDue;

  const hints: string[] = [];
  if (wall.length > 0) {
    const danger = wall.filter((w) => w.level === "danger");
    if (danger.length > 0) {
      hints.push(
        `⚠️ 未来 3 个月内 ${danger.length} 笔到期（合计剩余 ¥${(danger.reduce((s, w) => s + w.balanceCents, 0) / 100).toFixed(0)}），先息后本的注意本金一次性归还`,
      );
    } else {
      hints.push(`未来 6 个月内 ${wall.length} 笔到期，建议提前安排结清资金`);
    }
  }
  if (gapCents < 0) hints.push("本月结余不足以覆盖剩余月供，注意还款资金安排");

  return NextResponse.json({
    totals: {
      balanceCents: totalAll, // 含亲友
      bankCents: totalBank, // 银行口径
      monthlyDueCents: monthlyDue,
      weightedRatePct: weightedRate,
      liabilityCount: active.length,
    },
    netWorthCents: assetBalance - totalAll,
    assetBalanceCents: assetBalance,
    wall,
    cashFlow: {
      monthKey,
      incomeCents,
      expenseCents,
      realizedCents,
      paidThisMonthCents: paidThisMonth,
      remainingDueCents: remainingDue,
      gapCents,
    },
    hints,
  });
}
