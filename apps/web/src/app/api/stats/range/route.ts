import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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

  const { rows } = await pool.query(
    `select ((b.start_at at time zone $2))::date::text as date,
            b.activity_id,
            sum(b.duration_min)::int as mins
     from time_blocks b
     where b.user_id = $1
       and ((b.start_at at time zone $2)::date) between $3::date and $4::date
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
