import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isValidYearMonth } from "@/server/platform/http/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/finance/overview?month=YYYY-MM —— 月度概览：收支/储蓄率/分类占比/预算进度/环比/草稿数/账户余额 */
export const GET = withAuth(async (req, { user }) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  // 仅验形状会放行 2025-13 → to_char 永不命中静默空数据：月份需在 01-12
  if (!isValidYearMonth(month)) {
    throw ApiError.badRequest("month 需为 YYYY-MM（月份 01-12）");
  }
  const TZ = "Asia/Shanghai"; // 与时间模块一致：按北京日期切月

  // 9-F sargable 化：to_char(occurred_at …) = 'YYYY-MM' 对列套函数，idx_tx_user_time 无法走范围扫描，
  // 每次请求都全量求值。北京为固定 UTC+8，月界可预计算成半开区间 [start, end)，SQL 改纯范围条件。
  const bjMonthRange = (ym: string): [string, string] => {
    const [y, m] = ym.split("-").map(Number);
    return [
      new Date(Date.UTC(y, m - 1, 1, -8)).toISOString(), // 北京 1 日 00:00 = UTC 前一日 16:00
      new Date(Date.UTC(y, m, 1, -8)).toISOString(),
    ];
  };

  const summary = async (m: string) => {
    const [start, end] = bjMonthRange(m);
    const { rows } = await pool.query(
      `select
         coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0) as out_cents,
         coalesce(sum(case when direction = 'in'  then amount_cents else 0 end), 0) as in_cents
       from transactions
       where user_id = $1 and is_draft = false
         and occurred_at >= $2 and occurred_at < $3`,
      [user.id, start, end],
    );
    const byCat: Record<string, number> = {};
    const cats = await pool.query(
      `select category, sum(amount_cents)::int as cents
       from transactions
       where user_id = $1 and is_draft = false and direction = 'out'
         and occurred_at >= $2 and occurred_at < $3
       group by category order by cents desc`,
      [user.id, start, end],
    );
    for (const r of cats.rows) byCat[r.category] = r.cents;
    return { outCents: Number(rows[0].out_cents), inCents: Number(rows[0].in_cents), byCategory: byCat };
  };

  const [cur, prev] = await Promise.all([summary(month), summary(monthOf(month, -1))]);

  // 近 6 个月（含当月）收支 → 储蓄率趋势；无流水的月份由前端补零
  const [trendStart, trendEnd] = [bjMonthRange(monthOf(month, -5))[0], bjMonthRange(month)[1]];
  const { rows: trendRows } = await pool.query(
    `select to_char(occurred_at at time zone $2, 'YYYY-MM') as month,
            sum(case when direction = 'out' then amount_cents else 0 end)::int as out_cents,
            sum(case when direction = 'in'  then amount_cents else 0 end)::int as in_cents
     from transactions
     where user_id = $1 and is_draft = false
       and occurred_at >= $3 and occurred_at < $4
     group by 1 order by 1`,
    [user.id, TZ, trendStart, trendEnd],
  );
  const trendMap = new Map(trendRows.map((r) => [r.month, r]));
  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = monthOf(month, i - 5);
    const row = trendMap.get(m);
    const outCents = row ? Number(row.out_cents) : 0;
    const inCents = row ? Number(row.in_cents) : 0;
    return {
      month: m,
      outCents,
      inCents,
      rate: inCents > 0 ? Math.round(((inCents - outCents) / inCents) * 100) : null,
    };
  });

  const { rows: draftRows } = await pool.query(
    `select count(*)::int as n from transactions where user_id = $1 and is_draft = true`,
    [user.id],
  );

  const { rows: budgetRows } = await pool.query(
    `select monthly_limit_cents, alert_threshold from budgets where user_id = $1`,
    [user.id],
  );

  const { rows: accounts } = await pool.query(
    `select a.id, a.name, a.icon, a.sort_order, a.created_at,
            a.opening_balance_cents as "openingBalanceCents",
            a.opening_balance_cents::bigint as "balanceCents"
     from accounts a
     where a.user_id = $1 and a.archived = false
     order by a.sort_order, a.created_at`,
    [user.id],
  );
  // ::bigint 防 int4 溢出，但 node-pg 对 bigint 返回 string：序列化统一 Number()，响应类型不变
  const accountList = accounts.map((r) => ({ ...r, balanceCents: Number(r.balanceCents) }));

  return NextResponse.json({
    month,
    outCents: cur.outCents,
    inCents: cur.inCents,
    byCategory: cur.byCategory,
    prev: { outCents: prev.outCents, inCents: prev.inCents },
    trend,
    draftCount: draftRows[0].n,
    budget: budgetRows[0] ?? { monthly_limit_cents: 0, alert_threshold: 80 },
    accounts: accountList,
  });
});

/** 月份平移（-1 上月）：UTC 算术平移（本地 Date getter 违反全站「UTC getter + 8h」口径，易被复制到不对称场景） */
function monthOf(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
