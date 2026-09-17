import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PG 容器为 UTC，「今天」必须按北京日期切分（凌晨 0~8 点 UTC 日期仍是昨天） */
const TZ = "Asia/Shanghai";

/** GET /api/today —— 工作台数据：待办 + 今日已完成待办 + 今日时间块 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows: todos } = await pool.query(
    `select t.*, a.name as activity_name, a.icon, a.color
     from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
     where t.user_id = $1 and t.status = 'pending'
     order by t.due_at asc nulls last, t.created_at desc`,
    [user.id],
  );
  const { rows: doneToday } = await pool.query(
    `select t.*, a.name as activity_name, a.icon
     from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
     where t.user_id = $1 and t.status = 'done'
       and (t.done_at at time zone $2)::date = (now() at time zone $2)::date
     order by t.done_at desc`,
    [user.id, TZ],
  );
  const { rows: blocks } = await pool.query(
    `select b.*, a.name as activity_name, a.icon, a.color
     from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
     where b.user_id = $1 and (b.start_at at time zone $2)::date = (now() at time zone $2)::date
     order by b.start_at desc`,
    [user.id, TZ],
  );
  const { rows: activities } = await pool.query(
    `select id, name, icon, color, sort_order from activities
     where user_id = $1 order by sort_order`,
    [user.id],
  );
  return NextResponse.json({ todos, doneToday, blocks, activities });
}
