import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** PG 容器为 UTC，按北京日期切分必须显式时区 */
const TZ = "Asia/Shanghai";

/** GET /api/blocks/range?from=YYYY-MM-DD&to=YYYY-MM-DD —— 区间内原始时间块 */
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
    `select b.*, a.name as activity_name, a.icon, a.color
     from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
     where b.user_id = $1
       and ((b.start_at at time zone $2)::date) between $3::date and $4::date
     order by b.start_at`,
    [user.id, TZ, from, to],
  );
  return NextResponse.json({ blocks: rows });
}
