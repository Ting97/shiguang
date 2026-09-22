import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getModuleUser } from "@/lib/modules";
import { categoryBreakdown } from "@shiguangri/shared/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 北京时区 YYYY-MM-DD（UTC+8 手动偏移，不依赖服务器时区） */
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
/** 某北京日历日所属周的周一（周一为周界） */
const mondayOf = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
};
const addDays = (dateStr: string, n: number) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** GET /api/finance/stats?period=day|week&date=YYYY-MM-DD —— 交易统计（纯 SQL，零 AI 消耗，FR-C2.7 ①） */
export async function GET(req: Request) {
  const user = await getModuleUser("trade_review");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通交易复盘模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "week" ? "week" : "day";
  const date = DATE_RE.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : bjToday();

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
    prevFrom = prevTo = addDays(date, -1);
  } else {
    from = mondayOf(date);
    to = addDays(from, 6);
    prevFrom = addDays(from, -7);
    prevTo = addDays(from, -1);
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
      const d = addDays(from, i);
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
}
