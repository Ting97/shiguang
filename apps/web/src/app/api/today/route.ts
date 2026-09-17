import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/today —— 工作台数据：待办 + 今日已完成待办 + 今日时间块 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows: todos } = await pool.query(
    `select t.*, a.name as activity_name, a.icon, a.color
     from todos t left join activities a on a.id = t.activity_id
     where t.user_id = $1 and t.status = 'pending'
     order by t.due_at asc nulls last, t.created_at desc`,
    [user.id],
  );
  const { rows: doneToday } = await pool.query(
    `select t.*, a.name as activity_name, a.icon
     from todos t left join activities a on a.id = t.activity_id
     where t.user_id = $1 and t.status = 'done' and t.done_at::date = current_date
     order by t.done_at desc`,
    [user.id],
  );
  const { rows: blocks } = await pool.query(
    `select b.*, a.name as activity_name, a.icon, a.color
     from time_blocks b join activities a on a.id = b.activity_id
     where b.user_id = $1 and b.start_at::date = current_date
     order by b.start_at desc`,
    [user.id],
  );
  const { rows: activities } = await pool.query(
    `select id, name, icon, color, sort_order from activities
     where user_id = $1 order by sort_order`,
    [user.id],
  );
  return NextResponse.json({ todos, doneToday, blocks, activities });
}
