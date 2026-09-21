import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { TodoItem, TodoRow } from "@shiguangri/shared/types";

export const runtime = "nodejs";

/** PG 侧「北京今天」表达式（跨零点惰性失效的今日标记比对基准） */
const BJ_TODAY = "(now() at time zone 'Asia/Shanghai')::date";
/** 记录日（06:00 日切，REQ-001 R3）：00:00–05:59 仍算前一记录日（与全局凌晨回填口径一致） */
const EFF_TODAY = "((now() at time zone 'Asia/Shanghai') - interval '6 hours')::date";

const SELECT_TODO = `
  select t.*, a.name as activity_name, a.icon, a.color
  from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id`;

/** 惰性日切：每日重复的已完成行动，记录日推进后首次读取即恢复为未完成（系统惯例：读时判断，无 cron） */
async function restoreRepeating(userId: string): Promise<void> {
  await pool.query(
    `update todos set status = 'pending', done_at = null
     where user_id = $1 and repeat_daily and status = 'done'
       and coalesce(last_done_date, 'epoch'::date) < ${EFF_TODAY}`,
    [userId],
  );
}

/** 智能列表视图：today=今日标记 / important=⭐ / all=全部未完成 / done=已完成 / today-actions=首页今日行动清单（行动级） */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const view = new URL(req.url).searchParams.get("view") ?? "all";

  // 计数徽标：四个智能列表的顶层待办数（done 含子待办，勾一个减一个）
  const { rows: countRows } = await pool.query(
    `select
       count(*) filter (where status = 'pending' and today_tag_date = ${BJ_TODAY})::int as today,
       count(*) filter (where status = 'pending' and is_important and parent_todo_id is null)::int as important,
       count(*) filter (where status = 'pending' and parent_todo_id is null)::int as all_pending,
       count(*) filter (where status = 'done')::int as done
     from todos where user_id = $1`,
    [user.id],
  );
  const counts = {
    today: countRows[0]?.today ?? 0,
    important: countRows[0]?.important ?? 0,
    all: countRows[0]?.all_pending ?? 0,
    done: countRows[0]?.done ?? 0,
  };

  // 首页「今日行动清单」：行动级扁平列表（重复行动每天出现 ∪ 父待办标记今日 ∪ 父待办今日到期）
  if (view === "today-actions") {
    await restoreRepeating(user.id);
    const { rows } = await pool.query(
      `select a.*, p.title as parent_title, p.due_at as parent_due
       from todos a join todos p on p.id = a.parent_todo_id
       where a.user_id = $1
         and ( a.repeat_daily
            or p.today_tag_date = ${BJ_TODAY}
            or ((p.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY} and p.status = 'pending') )
       order by (a.status = 'done'), p.due_at nulls last, p.created_at, a.sort
       limit 200`,
      [user.id],
    );
    return NextResponse.json({ actions: rows, counts });
  }

  // 06:00 日切恢复在四视图读取前执行（重复行动次日回到未完成）
  await restoreRepeating(user.id);

  // 顶层待办：视图过滤 + 排序（重要在前，同组新建在前；done 视图按完成时间倒序）
  const where =
    view === "today" ? `parent_todo_id is null and status = 'pending' and today_tag_date = ${BJ_TODAY}`
    : view === "important" ? `parent_todo_id is null and status = 'pending' and is_important`
    : view === "done" ? `parent_todo_id is null and status = 'done'`
    : `parent_todo_id is null and status = 'pending'`;
  const order = view === "done" ? "t.done_at desc" : "t.is_important desc, t.created_at desc";
  const { rows: parents } = await pool.query(
    `${SELECT_TODO} where t.user_id = $1 and ${where} order by ${order} limit 200`,
    [user.id],
  );

  // 行动随待办返回（仅一层）：未完成在前、完成沉底，按 sort（插入式拆解的定位）
  let todos: TodoItem[] = parents.map((p) => ({ ...p, children: [] }));
  if (parents.length > 0) {
    const ids = parents.map((p) => p.id);
    const { rows: kids } = await pool.query(
      `${SELECT_TODO} where t.user_id = $1 and t.parent_todo_id = any($2::uuid[])
       order by (t.status = 'done'), t.sort, t.created_at`,
      [user.id, ids],
    );
    const byParent = new Map<string, TodoRow[]>(parents.map((p) => [p.id, []]));
    for (const k of kids) byParent.get(k.parent_todo_id)?.push(k);
    todos = parents.map((p) => ({ ...p, children: byParent.get(p.id) ?? [] }));
  }

  return NextResponse.json({ todos, counts });
}

/**
 * POST /api/todos —— 手动新增待办/行动：只需标题，不做时间控制（due_at 留空，
 * 时间感由「无时间」标签呈现，之后仍可在待办行内编辑里补充）。
 * - parentId 建行动（最多一层）；important/today 直接带标记（仅顶层）
 * - spaceId 关联目标空间（校验属主）
 * - afterId 插入式定位（AI 拆解/手动插入）：新行动排在 afterId 行动之后，后续行动 sort 平移
 * - repeatDaily 每日重复（仅行动；06:00 日切惰性恢复）
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    activityId?: string;
    parentId?: string;
    important?: boolean;
    today?: boolean;
    dueAt?: string | null; // ISO；null/缺省=无时间（之后行内编辑补充）
    note?: string | null; // 行动描述内容（≤1000 字）
    spaceId?: string | null;
    afterId?: string | null;
    repeatDaily?: boolean;
  };
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "标题太长了（≤200 字）" }, { status: 400 });
  const note = body.note?.trim() ? body.note.trim() : null;
  if (note && note.length > 1000) return NextResponse.json({ error: "详情内容太长了（≤1000 字）" }, { status: 400 });

  // 行动：校验父属主 + 最多一层（父自身不得再有 parent，且须未完成）；行动空间缺省继承父待办
  let parentId: string | null = null;
  let parentSpaceId: string | null = null;
  if (body.parentId) {
    const hit = await pool.query(
      `select id, space_id from todos where id = $1 and user_id = $2 and parent_todo_id is null and status = 'pending'`,
      [body.parentId, user.id],
    );
    if (!hit.rows[0]) {
      return NextResponse.json({ error: "只能给未完成的顶层任务添加行动" }, { status: 400 });
    }
    parentId = hit.rows[0].id;
    parentSpaceId = hit.rows[0].space_id ?? null;
  }

  // 空间归属：显式指定校验属主；行动未显式指定时继承父待办
  let spaceId: string | null = null;
  if (body.spaceId) {
    const hit = await pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [body.spaceId, user.id]);
    if (!hit.rows[0]) return NextResponse.json({ error: "空间不存在" }, { status: 400 });
    spaceId = hit.rows[0].id;
  } else if (parentId && body.spaceId === undefined) {
    spaceId = parentSpaceId;
  }

  // 分类：显式指定且属于该用户则用之，否则回退「其他」；再没有就置空（前端显示 📌）
  let activityId: string | null = null;
  if (body.activityId) {
    const hit = await pool.query(`select id from activities where id = $1 and user_id = $2`, [
      body.activityId,
      user.id,
    ]);
    activityId = hit.rows[0]?.id ?? null;
  }
  if (!activityId) {
    const other = await pool.query(
      `select id from activities where user_id = $1 order by (id = 'other') desc, sort_order limit 1`,
      [user.id],
    );
    activityId = other.rows[0]?.id ?? null;
  }

  // 标记只作用于顶层任务（行动随父走）：today=true 写入北京今天的日期
  const marked = !parentId;
  const dueAt = body.dueAt ?? null;

  // 行动插入式定位：afterId（同父行动）之后插入，后续行动 sort 平移；无 afterId 追加尾部
  let sort: number;
  if (parentId) {
    if (body.afterId) {
      const anchor = (
        await pool.query(
          `select sort from todos where id = $1 and user_id = $2 and parent_todo_id = $3`,
          [body.afterId, user.id, parentId],
        )
      ).rows[0];
      if (!anchor) return NextResponse.json({ error: "插入位置不存在" }, { status: 400 });
      await pool.query(
        `update todos set sort = sort + 1 where user_id = $1 and parent_todo_id = $2 and sort > $3`,
        [user.id, parentId, anchor.sort],
      );
      sort = anchor.sort + 1;
    } else {
      const max = (
        await pool.query(`select coalesce(max(sort), 0)::int as m from todos where user_id = $1 and parent_todo_id = $2`, [
          user.id,
          parentId,
        ])
      ).rows[0].m;
      sort = max + 1;
    }
  } else {
    sort = 0;
  }

  const todo = (
    await pool.query(
      `insert into todos (user_id, title, activity_id, source, parent_todo_id, is_important, today_tag_date, due_at, remind_at, note, space_id, sort, repeat_daily)
       values ($1, $2, $3, 'manual', $4, $5,
               ${marked && body.today ? BJ_TODAY : "null"},
               $6, $7, $8, $9, $10, $11) returning *`,
      [
        user.id, title, activityId, parentId, marked && body.important ? true : false,
        dueAt, dueAt ? new Date(new Date(dueAt).getTime() - 15 * 60_000).toISOString() : null,
        note, spaceId, sort,
        parentId ? body.repeatDaily === true : false, // 每日重复仅对行动生效
      ],
    )
  ).rows[0];
  return NextResponse.json({ todo });
}
