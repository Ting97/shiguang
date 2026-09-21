import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { TodoItem, TodoRow } from "@shiguangri/shared/types";

export const runtime = "nodejs";

/** PG 侧「北京今天」表达式（跨零点惰性失效的今日标记比对基准） */
const BJ_TODAY = "(now() at time zone 'Asia/Shanghai')::date";

const SELECT_TODO = `
  select t.*, a.name as activity_name, a.icon, a.color
  from todos t left join activities a on a.id = t.activity_id and a.user_id = t.user_id`;

/** 智能列表视图：today=今日标记 / important=⭐ / all=全部未完成 / done=已完成 */
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

  // 子待办随父返回（最多一层）：pending 在前、完成沉底，各按创建顺序
  let todos: TodoItem[] = parents.map((p) => ({ ...p, children: [] }));
  if (parents.length > 0) {
    const ids = parents.map((p) => p.id);
    const { rows: kids } = await pool.query(
      `${SELECT_TODO} where t.user_id = $1 and t.parent_todo_id = any($2::uuid[])
       order by (t.status = 'done'), t.created_at`,
      [user.id, ids],
    );
    const byParent = new Map<string, TodoRow[]>(parents.map((p) => [p.id, []]));
    for (const k of kids) byParent.get(k.parent_todo_id)?.push(k);
    todos = parents.map((p) => ({ ...p, children: byParent.get(p.id) ?? [] }));
  }

  return NextResponse.json({ todos, counts });
}

/**
 * POST /api/todos —— 手动新增待办：只需标题，不做时间控制（due_at 留空，
 * 时间感由「无时间」标签呈现，之后仍可在待办行内编辑里补充）。
 * 扩展（migrations/020）：parentId 建子待办（最多一层）；important/today 直接带标记。
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
    note?: string | null; // 子任务详情内容（≤1000 字）
  };
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "标题太长了（≤200 字）" }, { status: 400 });
  const note = body.note?.trim() ? body.note.trim() : null;
  if (note && note.length > 1000) return NextResponse.json({ error: "详情内容太长了（≤1000 字）" }, { status: 400 });

  // 子待办：校验父属主 + 最多一层（父自身不得再有 parent，且须未完成）
  let parentId: string | null = null;
  if (body.parentId) {
    const hit = await pool.query(
      `select id from todos where id = $1 and user_id = $2 and parent_todo_id is null and status = 'pending'`,
      [body.parentId, user.id],
    );
    if (!hit.rows[0]) {
      return NextResponse.json({ error: "只能给未完成的顶层任务添加子任务" }, { status: 400 });
    }
    parentId = hit.rows[0].id;
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

  // 标记只作用于顶层任务（子待办随父走）：today=true 写入北京今天的日期
  const marked = !parentId;
  const dueAt = body.dueAt ?? null;
  const todo = (
    await pool.query(
      `insert into todos (user_id, title, activity_id, source, parent_todo_id, is_important, today_tag_date, due_at, remind_at, note)
       values ($1, $2, $3, 'manual', $4, $5,
               ${marked && body.today ? BJ_TODAY : "null"},
               $6, $7, $8) returning *`,
      [user.id, title, activityId, parentId, marked && body.important ? true : false, dueAt, dueAt ? new Date(new Date(dueAt).getTime() - 15 * 60_000).toISOString() : null, note],
    )
  ).rows[0];
  return NextResponse.json({ todo });
}
