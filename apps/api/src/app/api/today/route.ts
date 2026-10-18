import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";
import { resolveUserModules } from "@/server/platform/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PG 容器为 UTC，「今天」必须按北京日期切分（凌晨 0~8 点 UTC 日期仍是昨天） */
const TZ = "Asia/Shanghai";

/** GET /api/today —— 工作台数据：今日 TODO（标记今日的，含子任务）+ 今日已完成待办 + 今日时间块。
 *  聚合端点按模块过滤而非 403（REQ-028 FR-A7）：todos 常开（time/goal 跨域消费）；
 *  time 关 → blocks/activities 置空；fitness 关 → todayKcal 归零。 */
export const GET = withAuth(async (_req, { user }) => {
  const { modules } = await resolveUserModules(user);
  const timeOn = modules.includes("time");
  const fitnessOn = modules.includes("fitness");
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
  // 9-F：doneToday/blocks/activities/kcal 四查互不依赖，并行执行（此前串行白叠 3 个 RTT）；
  // 模块关闭的查询跳过（空态由过滤值兜底），不为已关模块白跑 SQL
  const [{ rows: doneToday }, blocksRes, activitiesRes, kcalRows] = await Promise.all([
    pool.query(
      `select t.*, a.name as activity_name, a.icon
       from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id
       where t.user_id = $1 and t.status = 'done'
         and (t.done_at at time zone $2)::date = (now() at time zone $2)::date
       order by t.done_at desc`,
      [user.id, TZ],
    ),
    timeOn
      ? pool.query(
          `select b.*, a.name as activity_name, a.icon, a.color
           from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
           where b.user_id = $1
             and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(
                  date_trunc('day', now() at time zone $2) at time zone $2,
                  (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2)
           order by b.start_at desc`,
          [user.id, TZ],
        )
      : Promise.resolve({ rows: [] }),
    timeOn
      ? pool.query(
          `select id, name, icon, color, sort_order from activities
           where user_id = $1 order by sort_order`,
          [user.id],
        )
      : Promise.resolve({ rows: [] }),
    fitnessOn
      ? pool.query(
          `select coalesce(sum(d.total_kcal), 0)::int as kcal
           from diet_records d
           join entries e on e.id = d.entry_id
           where d.user_id = $1
             and coalesce(d.total_kcal, 0) > 0
             and e.created_at >= date_trunc('day', now() at time zone $2) at time zone $2
             and e.created_at < (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2`,
          [user.id, TZ],
        )
      : Promise.resolve({ rows: [{ kcal: 0 }] }),
  ]);
  const blocks = blocksRes.rows;
  const activities = activitiesRes.rows;
  const todayKcal = kcalRows.rows[0]?.kcal ?? 0;
  return NextResponse.json({ todos, doneToday, blocks, activities, todayKcal });
});
