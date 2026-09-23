import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isValidCalendarDate } from "@/server/platform/http/datetime";
import { categoryBreakdown } from "@shiguangri/shared/finance";
import { bjAddDays, bjMondayOf, bjToday } from "@shiguangri/shared/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";


/** GET /api/finance/stats?period=day|week&date=YYYY-MM-DD —— 交易统计（纯 SQL，零 AI 消耗，FR-C2.7 ①） */
export const GET = withModule("trade_review", async (req, { user }) => {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "week" ? "week" : "day";
  const q = url.searchParams.get("date");
  // 形状校验放行 2025-13-01 → bjAddDays/bjMondayOf RangeError 500：必须为真实日历日
  if (q !== null && !isValidCalendarDate(q)) {
    throw ApiError.badRequest("date 需为真实存在的 YYYY-MM-DD 日期");
  }
  const date = q ?? bjToday();

  const totals = async (cond: string, params: unknown[]) => {
    const { rows } = await pool.query(
      `select coalesce(sum(case when direction = 'in' then amount_cents end), 0)::bigint as inc,
              coalesce(sum(case when direction = 'out' then amount_cents end), 0)::bigint as out,
              count(*)::int as n
       from transactions where user_id = $1 and is_draft = false and ${cond}`,
      [user.id, ...params],
    );
    return { inCents: Number(rows[0].inc), outCents: Number(rows[0].out), count: rows[0].n };
  };

  let from: string, to: string, prevFrom: string, prevTo: string;
  if (period === "day") {
    from = to = date;
    prevFrom = prevTo = bjAddDays(date, -1);
  } else {
    from = bjMondayOf(date);
    to = bjAddDays(from, 6);
    prevFrom = bjAddDays(from, -7);
    prevTo = bjAddDays(from, -1);
  }
  const rangeCond = `(occurred_at at time zone $2)::date between $3::date and $4::date`;

  const [cur, prev, byCat, byAccount, topParty] = await Promise.all([
    totals(rangeCond, [TZ, from, to]),
    totals(rangeCond, [TZ, prevFrom, prevTo]),
    pool.query(
      `select category, coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as cents
       from transactions where user_id = $1 and is_draft = false and ${rangeCond}
       group by category order by cents desc`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select coalesce(a.name, '未指定') as name, coalesce(a.icon, '💳') as icon,
              coalesce(sum(case when t.direction = 'out' then t.amount_cents else 0 end), 0)::bigint as out_cents,
              coalesce(sum(case when t.direction = 'in' then t.amount_cents else 0 end), 0)::bigint as in_cents
       from transactions t left join accounts a on a.id = t.account_id
       where t.user_id = $1 and t.is_draft = false and ${rangeCond}
       group by a.name, a.icon order by out_cents desc`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select counterparty, count(*)::int as n,
              coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out_cents
       from transactions
       where user_id = $1 and is_draft = false and ${rangeCond}
         and counterparty is not null and char_length(counterparty) > 0
       group by counterparty order by out_cents desc, n desc limit 5`,
      [user.id, TZ, from, to],
    ),
  ]);

  // 周内日趋势（缺失日补零）
  const daily: { date: string; inCents: number; outCents: number }[] = [];
  if (period === "week") {
    const rows = (
      await pool.query(
        `select to_char((occurred_at at time zone $2)::date, 'YYYY-MM-DD') as d,
                coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
                coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out
         from transactions where user_id = $1 and is_draft = false and ${rangeCond}
         group by d order by d`,
        [user.id, TZ, from, to],
      )
    ).rows;
    const map = new Map(rows.map((r) => [r.d, r]));
    for (let i = 0; i < 7; i++) {
      const d = bjAddDays(from, i);
      const r = map.get(d);
      daily.push({ date: d, inCents: Number(r?.inc ?? 0), outCents: Number(r?.out ?? 0) });
    }
  }

  return NextResponse.json({
    period,
    date,
    range: { from, to },
    totals: cur,
    prev,
    byCategory: categoryBreakdown(Object.fromEntries(byCat.rows.map((r) => [r.category, Number(r.cents)]))),
    byAccount: byAccount.rows.map((r) => ({
      name: r.name,
      icon: r.icon,
      inCents: Number(r.in_cents),
      outCents: Number(r.out_cents),
    })),
    topCounterparties: topParty.rows.map((r) => ({
      name: r.counterparty,
      count: r.n,
      outCents: Number(r.out_cents),
    })),
    daily,
  });
});
