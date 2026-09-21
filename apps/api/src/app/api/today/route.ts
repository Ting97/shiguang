import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PG 容器为 UTC，「今天」必须按北京日期切分（凌晨 0~8 点 UTC 日期仍是昨天） */
const TZ = "Asia/Shanghai";

/** GET /api/today —— 工作台数据：今日 TODO（标记今日的，含子任务）+ 今日已完成待办 + 今日时间块 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 主页今日区只展示「手动标记今日」的待办（微软 To Do「我的一天」语义）：
  // today_tag_date = 北京今天，跨零点自动失效，由用户每天自行规划
  const { rows: parents } = await pool.query(
    `select t.*, a.name as activity_name, a.icon, a.color
     from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
     where t.user_id = $1 and t.status = 'pending' and t.parent_todo_id is null
       and t.today_tag_date = (now() at time zone $2)::date
     order by t.is_important desc, t.created_at desc`,
    [user.id, TZ],
  );
  let todos = parents.map((p) => ({ ...p, children: [] }));
  if (parents.length > 0) {
    const ids = parents.map((p) => p.id);
    const { rows: kids } = await pool.query(
      `select t.*, a.name as activity_name, a.icon, a.color
       from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
       where t.user_id = $1 and t.parent_todo_id = any($2::uuid[])
       order by (t.status = 'done'), t.created_at`,
      [user.id, ids],
    );
    const byParent = new Map<string, unknown[]>(parents.map((p) => [p.id, []]));
    for (const k of kids) byParent.get(k.parent_todo_id)?.push(k);
    todos = parents.map((p) => ({ ...p, children: byParent.get(p.id) ?? [] }));
  }
  const { rows: doneToday } = await pool.query(
    `select t.*, a.name as activity_name, a.icon
     from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
     where t.user_id = $1 and t.status = 'done'
       and (t.done_at at time zone $2)::date = (now() at time zone $2)::date
     order by t.done_at desc`,
    [user.id, TZ],
  );
  // 今日块：按「区间与今天有交集」取——跨天块（如昨晚23:00→今早07:00的睡眠）也要出现在今天，
  // 否则它的凌晨段在界面上不可见，但冲突检测仍会拦截，造成"有冲突却看不到块"的错觉
  const { rows: blocks } = await pool.query(
    `select b.*, a.name as activity_name, a.icon, a.color
     from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
     where b.user_id = $1
       and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(
            date_trunc('day', now() at time zone $2) at time zone $2,
            (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2)
     order by b.start_at desc`,
    [user.id, TZ],
  );
  const { rows: activities } = await pool.query(
    `select id, name, icon, color, sort_order from activities
     where user_id = $1 order by sort_order`,
    [user.id],
  );
  // 今日卡路里合计（饮食域）：只计「今天记录」的动态的饮食记录，按北京自然日切。
  // 旧口径用 created_at±12h 窗口与今天求交集，会把昨天 12:00 后记录的正餐/夜宵
  // 也算进今天（窗口宽达 24 小时，跨天双向渗漏），导致当日卡路里明显虚高。
  const { rows: kcalRows } = await pool.query(
    `select coalesce(sum(d.total_kcal), 0)::int as kcal
     from diet_records d
     join entries e on e.id = d.entry_id
     where d.user_id = $1
       and coalesce(d.total_kcal, 0) > 0
       and e.created_at >= date_trunc('day', now() at time zone $2) at time zone $2
       and e.created_at < (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2`,
    [user.id, TZ],
  );
  const todayKcal = kcalRows[0]?.kcal ?? 0;
  return NextResponse.json({ todos, doneToday, blocks, activities, todayKcal });
}
