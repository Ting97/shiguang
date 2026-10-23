import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withModule } from "@/server/platform/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debts/overview —— 总览聚合（FR-C2.5）：
 * 总负债双口径/月供合计+到期提示/加权利率/净资产/到期墙（≤3月 danger、≤6月 warn）/现金流月视图 */
export const GET = withModule("debt", async (_req, { user }) => {
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

  // 净资产 = 资产账户余额合计 − 总负债（含亲友口径）。
  // 余额口径与 /api/accounts、/api/finance/overview 对齐：期初即余额，账户联动流水不入账
  // （旧版把流水也折进来 → 记一笔联动还款后账户卡不变而净资产双动，两页数字对不上）
  const assets = (
    await pool.query(
      `select coalesce(sum(a.opening_balance_cents), 0)::bigint as balance
       from accounts a where a.user_id = $1 and a.archived = false`,
      [user.id],
    )
  ).rows[0];
  const assetBalance = Number(assets.balance);

  // 到期墙：未来 6 个月内到期（先息后本 = 本金到期节点）+ 已逾期段（二十轮 P2）。
  // 旧版 dm>=0 过滤把 due 已过的活跃负债整体排除——先息后本类一旦逾期，本金风险从总览
  // 消失（余额仍挂账但墙里看不见），与备付页同样盲区，一并补
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
    .filter((r) => r.dm <= 6)
    .sort((a, b) => a.dm - b.dm) // 逾期（dm<0）排最前，按逾期时间降序
    .map((r) => {
      const daysLeft = Math.round((Date.parse(`${r.due}T00:00:00Z`) - todayBjMs) / 86_400_000);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        dueDate: r.due,
        balanceCents: Number(r.balance_cents),
        monthlyCents: r.monthly_cents === null ? null : Number(r.monthly_cents),
        daysLeft,
        // 已逾期 > 未来 3 个月 danger > warn；daysLeft 负数=已逾期 N 天（前端相应渲染）
        level: daysLeft < 0 ? "overdue" : r.dm <= 3 ? "danger" : "warn",
      };
    });

  // 现金流月视图：本月真实收支 vs 月供应还（已关联记账的还款不重复扣）。
  // sargable 化（与 finance/overview 同范式）：to_char(occurred_at…) = 'YYYY-MM' 对列套函数
  // 不可走索引全量求值；to_char(paid_at,…) 还隐含会话时区（生产 UTC 会话下月初 0-8 点的还款
  // 会被记到上月）——统一预计算北京月界半开区间 [start, end) 纯范围比较
  const monthKey = nowBj.toISOString().slice(0, 7);
  const [my, mm] = monthKey.split("-").map(Number);
  const nextMonthKey = `${mm === 12 ? my + 1 : my}-${mm === 12 ? "01" : String(mm + 1).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(my, mm - 1, 1, -8)).toISOString();
  const monthEnd = new Date(Date.UTC(my, mm, 1, -8)).toISOString();
  const cf = (
    await pool.query(
      `select
         coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
         coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out
       from transactions
       where user_id = $1 and is_draft = false
         and occurred_at >= $2 and occurred_at < $3`,
      [user.id, monthStart, monthEnd],
    )
  ).rows[0];
  const paidThisMonth = Number(
    (
      await pool.query(
        // paid_at 是 date 列（二十轮 P2）：传 timestamptz 形参时 PG 类型推断按 date>=date 精确匹配，
        // text→date 转换忽略时区按字面日期截断——窗口起点实际是「上月最后一日」而非北京本月一日，
        // 整月期间 paidThisMonth 恒多计上月末日的还款。改传纯日期串 + ::date 显式收口（半开区间）
        `select coalesce(sum(amount_cents), 0)::bigint as n from liability_payments
         where user_id = $1 and paid_at >= $2::date and paid_at < $3::date`,
        [user.id, `${monthKey}-01`, `${nextMonthKey}-01`],
      )
    ).rows[0].n,
  );
  const incomeCents = Number(cf.inc);
  const expenseCents = Number(cf.out);
  const realizedCents = incomeCents - expenseCents;
  const remainingDue = Math.max(0, monthlyDue - paidThisMonth);
  const gapCents = realizedCents - remainingDue;

  const hints: string[] = [];
  const overdue = wall.filter((w) => w.level === "overdue");
  if (overdue.length > 0) {
    hints.push(
      `🚨 ${overdue.length} 笔已逾期（合计剩余 ¥${(overdue.reduce((s, w) => s + w.balanceCents, 0) / 100).toFixed(0)}），请优先安排还款`,
    );
  }
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
});
