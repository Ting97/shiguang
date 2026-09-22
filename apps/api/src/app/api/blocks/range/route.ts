import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

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
  // 按「区间与查询日期有交集」取：跨天块在其覆盖的每一天都返回（前端按天钳制显示），
  // 避免开始日在前一天的凌晨占用段在当天不可见、却仍触发冲突拦截
  const { rows } = await pool.query(
    `select b.*, a.name as activity_name, a.icon, a.color
     from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
     where b.user_id = $1
       and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(
            $3::date::timestamp at time zone $2,
            ($4::date + 1)::timestamp at time zone $2)
     order by b.start_at`,
    [user.id, TZ, from, to],
  );
  return NextResponse.json({ blocks: rows });
}
