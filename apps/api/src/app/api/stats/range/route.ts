import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "Asia/Shanghai";

/** GET /api/stats/range?from=&to= —— 按日按类别的时长聚合（月视图/年热力图/趋势用） */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ error: "from/to 需为合法日期且 from ≤ to" }, { status: 400 });
  }

  // 按天交集钳制：跨天块（如昨晚23:00→今早07:00的睡眠）的时长分摊到它覆盖的每一天，
  // 与日视图/周视图的交集口径一致（旧实现按开始日归全长，跨天块会整段记在一天）
  const { rows } = await pool.query(
    `select to_char(d.day, 'YYYY-MM-DD') as date,
            b.activity_id,
            sum(floor(extract(epoch from least((b.end_at at time zone $2), (d.day + interval '1 day'))
                             - greatest((b.start_at at time zone $2), d.day)) / 60))::int as mins
     from time_blocks b
     join lateral generate_series(
            greatest(date_trunc('day', b.start_at at time zone $2), $3::date::timestamp),
            least(date_trunc('day', b.end_at at time zone $2), $4::date::timestamp),
            interval '1 day') d(day) on true
     where b.user_id = $1
       and least((b.end_at at time zone $2), (d.day + interval '1 day')) > greatest((b.start_at at time zone $2), d.day)
     group by 1, 2`,
    [user.id, TZ, from, to],
  );

  const daysMap = new Map<string, { date: string; totalMin: number; byActivity: Record<string, number> }>();
  const totals: Record<string, number> = {};
  for (const r of rows) {
    if (!daysMap.has(r.date)) daysMap.set(r.date, { date: r.date, totalMin: 0, byActivity: {} });
    const d = daysMap.get(r.date)!;
    d.byActivity[r.activity_id] = r.mins;
    d.totalMin += r.mins;
    totals[r.activity_id] = (totals[r.activity_id] ?? 0) + r.mins;
  }
  return NextResponse.json({ days: [...daysMap.values()], totals });
}
