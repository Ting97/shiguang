import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/finance/overview?month=YYYY-MM —— 月度概览：收支/储蓄率/分类占比/预算进度/环比/草稿数/账户余额 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month 需为 YYYY-MM" }, { status: 400 });
  }
  const TZ = "Asia/Shanghai"; // 与时间模块一致：按北京日期切月

  const summary = async (m: string) => {
    const { rows } = await pool.query(
      `select
         coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0) as out_cents,
         coalesce(sum(case when direction = 'in'  then amount_cents else 0 end), 0) as in_cents
       from transactions
       where user_id = $1 and is_draft = false
         and to_char(occurred_at at time zone $2, 'YYYY-MM') = $3`,
      [user.id, TZ, m],
    );
    const byCat: Record<string, number> = {};
    const cats = await pool.query(
      `select category, sum(amount_cents)::int as cents
       from transactions
       where user_id = $1 and is_draft = false and direction = 'out'
         and to_char(occurred_at at time zone $2, 'YYYY-MM') = $3
       group by category order by cents desc`,
      [user.id, TZ, m],
    );
    for (const r of cats.rows) byCat[r.category] = r.cents;
    return { outCents: Number(rows[0].out_cents), inCents: Number(rows[0].in_cents), byCategory: byCat };
  };

  const [cur, prev] = await Promise.all([summary(month), summary(monthOf(month, -1))]);

  // 近 6 个月（含当月）收支 → 储蓄率趋势；无流水的月份由前端补零
  const { rows: trendRows } = await pool.query(
    `select to_char(occurred_at at time zone $2, 'YYYY-MM') as month,
            sum(case when direction = 'out' then amount_cents else 0 end)::int as out_cents,
            sum(case when direction = 'in'  then amount_cents else 0 end)::int as in_cents
     from transactions
     where user_id = $1 and is_draft = false
       and to_char(occurred_at at time zone $2, 'YYYY-MM') >= $3
     group by 1 order by 1`,
    [user.id, TZ, monthOf(month, -5)],
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
    `select a.id, a.name, a.icon, a.opening_balance_cents,
            (a.opening_balance_cents + coalesce((
               select sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end)
               from transactions t
               where t.account_id = a.id and t.is_draft = false
             ), 0))::int as balance_cents
     from accounts a
     where a.user_id = $1 and a.archived = false
     order by a.sort_order, a.created_at`,
    [user.id],
  );

  return NextResponse.json({
    month,
    outCents: cur.outCents,
    inCents: cur.inCents,
    byCategory: cur.byCategory,
    prev: { outCents: prev.outCents, inCents: prev.inCents },
    trend,
    draftCount: draftRows[0].n,
    budget: budgetRows[0] ?? { monthly_limit_cents: 0, alert_threshold: 80 },
    accounts,
  });
}

/** 月份平移（-1 上月） */
function monthOf(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
