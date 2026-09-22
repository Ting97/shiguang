/**
 * goal 域 repo（REQ-004 FR-B1.2）：todos / goal_spaces / space_reflections 的 SQL 唯一发生地。
 * 迁移批③：路由主体（含动态拼接表达式）逐字下沉，不改任何查询语义。
 */
import { pool } from "@/server/platform/db";
import type { TodoPatchInput } from "./service";

type DB = typeof pool | import("pg").PoolClient;

/** PG 侧「北京今天」表达式（跨零点惰性失效的今日标记比对基准） */
export const BJ_TODAY = "(now() at time zone 'Asia/Shanghai')::date";
/** 记录日（06:00 日切，REQ-001 R3）：00:00–05:59 仍算前一记录日（与全局凌晨回填口径一致） */
export const EFF_TODAY = "((now() at time zone 'Asia/Shanghai') - interval '6 hours')::date";

const SELECT_TODO = `
  select t.*, a.name as activity_name, a.icon, a.color
  from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id`;

export const todoRepo = {
  /** 惰性日切：每日重复的已完成行动，记录日推进后首次读取即恢复为未完成（系统惯例：读时判断，无 cron） */
  async restoreRepeating(userId: string): Promise<void> {
    await pool.query(
      `update todos set status = 'pending', done_at = null
       where user_id = $1 and repeat_daily and status = 'done'
         and coalesce(last_done_date, 'epoch'::date) < ${EFF_TODAY}`,
      [userId],
    );
  },

  /** 计数徽标：四个智能列表的顶层待办数（done 含子待办，勾一个减一个）；今日含过期未完成 */
  async counts(userId: string) {
    return (
      await pool.query(
        `select
           count(*) filter (where status = 'pending' and parent_todo_id is null and (today_tag_date = ${BJ_TODAY} or (due_at is not null and (due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY})))::int as today,
           count(*) filter (where status = 'pending' and is_important and parent_todo_id is null)::int as important,
           count(*) filter (where status = 'pending' and parent_todo_id is null)::int as all_pending,
           count(*) filter (where status = 'done')::int as done
         from todos where user_id = $1`,
        [userId],
      )
    ).rows;
  },

  /** 首页「今日行动清单」v2（REQ-002 N6）：全部行动（kind='action'，含独立行动）+ 今天到期/过期的顶层 todo */
  todayActions(userId: string) {
    return pool.query(
      `select x.* from (
         select a.*, p.title as parent_title, p.due_at as parent_due
         from todos a left join todos p on p.id = a.parent_todo_id
         where a.user_id = $1 and a.kind = 'action'
           and ( a.repeat_daily
              or a.today_tag_date = ${BJ_TODAY}
              or ((a.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY})
              or ((a.due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY} and a.status = 'pending')
              or p.today_tag_date = ${BJ_TODAY}
              or ((p.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY} and p.status = 'pending') )
         union all
         select t.*, null::text as parent_title, t.due_at as parent_due
         from todos t
         where t.user_id = $1 and t.parent_todo_id is null and t.kind = 'todo'
           and (
             (t.status in ('pending', 'done') and (t.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY})
             or (t.status = 'pending' and t.due_at is not null and (t.due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY})
           )
       ) x
       order by (x.status = 'done'), x.parent_due nulls last, x.created_at, x.sort
       limit 200`,
      [userId],
    );
  },

  /** 顶层待办：视图过滤 + 排序（重要在前，同组新建在前；done 视图按完成时间倒序） */
  parentsOfView(userId: string, view: string) {
    const where =
      view === "today" ? `parent_todo_id is null and status = 'pending' and (today_tag_date = ${BJ_TODAY} or (due_at is not null and (due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY}))`
      : view === "important" ? `parent_todo_id is null and status = 'pending' and is_important`
      : view === "done" ? `parent_todo_id is null and status = 'done'`
      : `parent_todo_id is null and status = 'pending'`;
    const order = view === "done" ? "t.done_at desc" : "t.is_important desc, t.created_at desc";
    return pool.query(`${SELECT_TODO} where t.user_id = $1 and ${where} order by ${order} limit 200`, [userId]);
  },

  /** 行动随待办返回（仅一层）：未完成在前、完成沉底，按 sort（插入式拆解的定位） */
  childrenOf(userId: string, ids: string[]) {
    return pool.query(
      `${SELECT_TODO} where t.user_id = $1 and t.parent_todo_id = any($2::uuid[])
       order by (t.status = 'done'), t.sort, t.created_at`,
      [userId, ids],
    );
  },

  /** 行动：校验父属主 + 最多一层（父自身不得再有 parent、须 kind='todo' 且未完成） */
  async topTodoOf(parentId: string, userId: string) {
    return (
      await pool.query(
        `select id, space_id from todos where id = $1 and user_id = $2 and parent_todo_id is null and kind = 'todo' and status = 'pending'`,
        [parentId, userId],
      )
    ).rows[0];
  },

  activityOwned(activityId: string, userId: string) {
    return pool.query(`select id from activities where id = $1 and user_id = $2`, [activityId, userId]);
  },

  /** 分类回退「其他」；再没有就置空（前端显示 📌） */
  fallbackActivity(userId: string) {
    return pool.query(`select id from activities where user_id = $1 order by (id = 'other') desc, sort_order limit 1`, [userId]);
  },

  /** 行动插入式定位：afterId（同父行动）锚点 */
  async sortAnchor(afterId: string, userId: string, parentId: string) {
    return (
      await pool.query(`select sort from todos where id = $1 and user_id = $2 and parent_todo_id = $3`, [
        afterId,
        userId,
        parentId,
      ])
    ).rows[0];
  },

  /** 锚点之后的行动 sort 平移 */
  shiftSortAfter(userId: string, parentId: string, sort: number) {
    return pool.query(`update todos set sort = sort + 1 where user_id = $1 and parent_todo_id = $2 and sort > $3`, [
      userId,
      parentId,
      sort,
    ]);
  },

  async maxSort(userId: string, parentId: string) {
    return (
      await pool.query(`select coalesce(max(sort), 0)::int as m from todos where user_id = $1 and parent_todo_id = $2`, [
        userId,
        parentId,
      ])
    ).rows[0];
  },

  /** 手动新增待办/行动（today 标记按「顶层且勾选」内联为北京今天表达式，与迁移前逐字一致） */
  insert(
    userId: string,
    p: {
      title: string;
      activityId: string | null;
      parentId: string | null;
      important: boolean;
      markToday: boolean;
      dueAt: string | null;
      remindAt: string | null;
      note: string | null;
      spaceId: string | null;
      sort: number;
      repeatDaily: boolean;
      kind: string;
    },
  ) {
    return pool.query(
      `insert into todos (user_id, title, activity_id, source, parent_todo_id, is_important, today_tag_date, due_at, remind_at, note, space_id, sort, repeat_daily, kind)
       values ($1, $2, $3, 'manual', $4, $5,
               ${p.markToday ? BJ_TODAY : "null"},
               $6, $7, $8, $9, $10, $11, $12) returning *`,
      [
        userId, p.title, p.activityId, p.parentId, p.important,
        p.dueAt, p.remindAt,
        p.note, p.spaceId, p.sort,
        p.repeatDaily, // 每日重复仅对行动生效（含独立行动）
        p.kind, // 子行动恒为 kind='action'（028 修复：此前带 parentId 新建的行动落了默认 'todo'，导致重复开关 400、行动统计漏计）
      ],
    );
  },

  // ---- PATCH 模式零：恢复为未完成 ----
  async findDone(client: DB, id: string, userId: string) {
    return (
      await client.query(`select * from todos where id = $1 and user_id = $2 and status = 'done'`, [id, userId])
    ).rows[0];
  },

  deleteDoneBlock(client: DB, blockId: string) {
    return client.query(`delete from time_blocks where id = $1`, [blockId]);
  },

  restore(client: DB, id: string) {
    return client.query(
      `update todos set status = 'pending', done_at = null, done_entry_id = null, done_block_id = null
       where id = $1 returning *`,
      [id],
    );
  },

  // ---- PATCH 模式一：勾选完成（每日重复行动：完成次数按记录日去重累加，并写 last_done_date） ----
  markDone(id: string, userId: string) {
    return pool.query(
      `update todos set
         status = 'done', done_at = now(),
         repeat_done_count = repeat_done_count
           + case when repeat_daily and coalesce(last_done_date, 'epoch'::date) < ${EFF_TODAY} then 1 else 0 end,
         last_done_date = case when repeat_daily then ${EFF_TODAY} else last_done_date end
       where id = $1 and user_id = $2 and status = 'pending' returning *`,
      [id, userId],
    );
  },

  // ---- PATCH 模式二：修改字段 ----
  async parentOf(id: string, userId: string) {
    return (await pool.query(`select parent_todo_id from todos where id = $1 and user_id = $2`, [id, userId])).rows[0];
  },

  async kindOf(id: string, userId: string) {
    return (await pool.query(`select kind from todos where id = $1 and user_id = $2`, [id, userId])).rows[0];
  },

  /** 空间归属（REQ-002 N1）：新关联/切换需带 status 判定（归档空间可移除不可新挂） */
  async spaceWithStatus(spaceId: string, userId: string) {
    return (
      await pool.query(`select id, status from goal_spaces where id = $1 and user_id = $2`, [spaceId, userId])
    ).rows[0];
  },

  /** 字段映射与 SQL 构造同源（调用前 note 长度校验已在 service 完成，行为与迁移前逐字一致）；
   * space_id 落校验后的值（body.spaceId 非法/空串时为 null=移除归属） */
  buildPatch(body: TodoPatchInput, spaceId: string | null): { sets: string[]; vals: unknown[] } {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body.title != null) { vals.push(body.title.trim()); sets.push(`title = $${vals.length}`); }
    if (body.dueAt !== undefined) {
      vals.push(body.dueAt); // null 允许，清除时间
      sets.push(`due_at = $${vals.length}::timestamptz`);
      sets.push(`remind_at = ($${vals.length}::timestamptz - interval '15 minutes')`);
    }
    if (body.startAt !== undefined) {
      vals.push(body.startAt); // null 允许，清除起始
      sets.push(`start_at = $${vals.length}::timestamptz`);
    }
    if (body.activityId != null) { vals.push(body.activityId); sets.push(`activity_id = $${vals.length}`); }
    if (body.note !== undefined) {
      vals.push(body.note?.trim() ? body.note.trim() : null);
      sets.push(`note = $${vals.length}`);
    }
    if (body.important !== undefined) { vals.push(Boolean(body.important)); sets.push(`is_important = $${vals.length}`); }
    if (body.today !== undefined) {
      // true → 标记为北京今天；false → 清除。查询按 today_tag_date = 今天 过滤，跨零点自动失效
      vals.push(Boolean(body.today));
      sets.push(`today_tag_date = case when $${vals.length} then (now() at time zone 'Asia/Shanghai')::date else null end`);
    }
    if (body.spaceId !== undefined) { vals.push(spaceId); sets.push(`space_id = $${vals.length}::uuid`); }
    if (body.repeatDaily !== undefined) { vals.push(Boolean(body.repeatDaily)); sets.push(`repeat_daily = $${vals.length}`); }
    return { sets, vals };
  },

  async updateFields(id: string, userId: string, sets: string[], vals: unknown[]) {
    return (
      await pool.query(
        `update todos set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length}
         returning *`,
        vals,
      )
    ).rows[0];
  },

  /** N1：归属变更时带最新空间摘要，供行内徽标即时更新 */
  async spaceSummary(spaceId: string, userId: string) {
    return (
      await pool.query(`select id, name, icon, color, status from goal_spaces where id = $1 and user_id = $2`, [
        spaceId,
        userId,
      ])
    ).rows[0];
  },

  remove(id: string, userId: string) {
    return pool.query(`delete from todos where id = $1 and user_id = $2 returning id, title`, [id, userId]);
  },
};

export const spaceRepo = {
  /** 属主校验（待办/感悟挂空间时用） */
  async ownedId(spaceId: string, userId: string) {
    return (await pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [spaceId, userId])).rows[0];
  },

  /** 空间列表（active 在前）+ 聚合统计（REQ-002 N2） */
  async listWithStats(userId: string) {
    return pool.query(
      `select s.*,
              coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is null), 0) as todo_total,
              coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is null and t.status = 'done'), 0) as todo_done,
              coalesce((select count(*)::int from todos t where t.space_id = s.id), 0) as todo_all_total,
              coalesce((select count(*)::int from todos t where t.space_id = s.id and t.status = 'done'), 0) as todo_all_done,
              coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is not null), 0) as action_total,
              coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is not null and t.status = 'done'), 0) as action_done,
              coalesce((select count(*)::int from entries e where e.space_id = s.id), 0) as entry_count,
              coalesce((select count(*)::int from space_reflections r where r.space_id = s.id), 0) as reflection_count
       from goal_spaces s
       where s.user_id = $1
       order by (s.status = 'active') desc, s.sort, s.created_at`,
      [userId],
    );
  },

  async countActive(userId: string) {
    return pool.query(`select count(*)::int as n from goal_spaces where user_id = $1 and status = 'active'`, [userId]);
  },

  insert(
    userId: string,
    name: string,
    description: string | null,
    icon: string | null,
    color: string | null,
    startedAt: string | null,
    targetDate: string | null,
  ) {
    return pool.query(
      `insert into goal_spaces (user_id, name, description, icon, color, started_at, target_date)
       values ($1,$2,$3,coalesce($4,'🎯'),coalesce($5,'#38bdf8'),$6,$7) returning *`,
      [userId, name, description, icon, color, startedAt, targetDate],
    );
  },

  /** 提供=有值才更新，避免"未传字段"与"清空字段"混淆（前端编辑器每次全量传） */
  update(
    id: string,
    userId: string,
    p: {
      name: string | null;
      hasDescription: boolean;
      description: string | null;
      icon: string | null;
      color: string | null;
      hasStartedAt: boolean;
      startedAt: string | null;
      hasTargetDate: boolean;
      targetDate: string | null;
      status: string | null;
      sort: number | null;
    },
  ) {
    return pool.query(
      `update goal_spaces set
         name = coalesce($2, name),
         description = case when $3 then $4 else description end,
         icon = coalesce($5, icon),
         color = coalesce($6, color),
         started_at = case when $7 then $8 else started_at end,
         target_date = case when $9 then $10 else target_date end,
         status = coalesce($11, status),
         sort = coalesce($12, sort),
         updated_at = now()
       where id = $1 and user_id = $13 returning *`,
      [
        id,
        p.name,
        p.hasDescription, p.description,
        p.icon,
        p.color,
        p.hasStartedAt, p.startedAt,
        p.hasTargetDate, p.targetDate,
        p.status,
        p.sort,
        userId,
      ],
    );
  },

  /** 硬删空间；entries/todos.space_id 由外键 on delete set null 兜底，业务数据完好 */
  remove(id: string, userId: string) {
    return pool.query(`delete from goal_spaces where id = $1 and user_id = $2`, [id, userId]);
  },
};

export const reflectionRepo = {
  async spaceOwned(spaceId: string, userId: string) {
    return (await pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [spaceId, userId])).rows[0];
  },

  /** 感悟列表（倒序；只回预览 300 字 + 字数，长列表性能） */
  list(spaceId: string, limit: number, offset: number) {
    return pool.query(
      `select id,
              left(content, 300) as preview,
              char_length(content)::int as chars,
              created_at, updated_at,
              (updated_at > created_at) as edited
       from space_reflections
       where space_id = $1
       order by created_at desc
       limit $2 offset $3`,
      [spaceId, limit, offset],
    );
  },

  async totalOf(spaceId: string) {
    return (
      await pool.query(`select count(*)::int as n from space_reflections where space_id = $1`, [spaceId])
    ).rows[0].n;
  },

  insert(userId: string, spaceId: string, content: string) {
    return pool.query(`insert into space_reflections (user_id, space_id, content) values ($1, $2, $3) returning *`, [
      userId,
      spaceId,
      content,
    ]);
  },

  /** 归属校验：感悟 → 空间 → 用户 一条 JOIN 判定 */
  async ownOf(rid: string, userId: string) {
    return (
      await pool.query(
        `select r.id from space_reflections r
         join goal_spaces s on s.id = r.space_id
         where r.id = $1 and s.user_id = $2`,
        [rid, userId],
      )
    ).rows[0];
  },

  async byId(rid: string) {
    return (
      await pool.query(`select id, content, created_at, updated_at from space_reflections where id = $1`, [rid])
    ).rows[0];
  },

  /** 编辑；updated_at=now()（列表据此刻画"已编辑"） */
  update(rid: string, content: string) {
    return pool.query(
      `update space_reflections set content = $1, updated_at = now() where id = $2 returning id, content, created_at, updated_at`,
      [content, rid],
    );
  },

  remove(rid: string) {
    return pool.query(`delete from space_reflections where id = $1`, [rid]);
  },
};
