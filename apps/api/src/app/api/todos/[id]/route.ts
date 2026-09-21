import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/** PATCH /api/todos/:id —— { done: true } 勾选完成；{ undone: true } 恢复；或传字段修改待办 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    done?: boolean;
    undone?: boolean;
    title?: string;
    dueAt?: string | null; // ISO；null=清除时间
    startAt?: string | null; // ISO；null=清除起始（区间待办用）
    activityId?: string;
    important?: boolean; // ⭐ 重要标记（仅顶层任务，子待办随父）
    today?: boolean; // ☀️ 今日标记：true=北京今天，false=清除（跨零点自动失效）
  };

  // ---- 模式零：恢复为未完成（撤销完成状态；历史版本完成时生成过日程块，一并删除） ----
  if (body.undone === true) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const todo = (
        await client.query(
          `select * from todos where id = $1 and user_id = $2 and status = 'done'`,
          [id, user.id],
        )
      ).rows[0];
      if (!todo) {
        await client.query("rollback");
        return NextResponse.json({ error: "待办不存在或未完成" }, { status: 404 });
      }
      if (todo.done_block_id) await client.query(`delete from time_blocks where id = $1`, [todo.done_block_id]);
      const restored = (
        await client.query(
          `update todos set status = 'pending', done_at = null, done_entry_id = null, done_block_id = null
           where id = $1 returning *`,
          [id],
        )
      ).rows[0];
      await client.query("commit");
      return NextResponse.json({ todo: restored });
    } catch (e) {
      await client.query("rollback");
      return NextResponse.json({ error: String(e) }, { status: 500 });
    } finally {
      client.release();
    }
  }

  // ---- 模式一：勾选完成（仅改状态；日程与待办解耦，完成不再生成时间块） ----
  if (body.done === true) {
    const todo = (
      await pool.query(
        `update todos set status = 'done', done_at = now()
         where id = $1 and user_id = $2 and status = 'pending' returning *`,
        [id, user.id],
      )
    ).rows[0];
    if (!todo) return NextResponse.json({ error: "待办不存在或已完成" }, { status: 404 });
    return NextResponse.json({ todo });
  }

  // ---- 模式二：修改字段 ----
  // 今日/重要标记只作用于顶层任务（子待办的上下文随父，避免「标记了却不出现在视图」的困惑）
  if (body.important !== undefined || body.today !== undefined) {
    const isChild = (
      await pool.query(`select parent_todo_id from todos where id = $1 and user_id = $2`, [id, user.id])
    ).rows[0]?.parent_todo_id;
    if (isChild) {
      return NextResponse.json({ error: "子任务不支持单独标记，请标记父任务" }, { status: 400 });
    }
  }
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
  if (body.important !== undefined) { vals.push(Boolean(body.important)); sets.push(`is_important = $${vals.length}`); }
  if (body.today !== undefined) {
    // true → 标记为北京今天；false → 清除。查询按 today_tag_date = 今天 过滤，跨零点自动失效
    vals.push(Boolean(body.today));
    sets.push(`today_tag_date = case when $${vals.length} then (now() at time zone 'Asia/Shanghai')::date else null end`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  vals.push(id, user.id);
  const updated = (
    await pool.query(
      `update todos set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length}
       returning *`,
      vals,
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "待办不存在" }, { status: 404 });
  return NextResponse.json({ todo: updated });
}

/** DELETE /api/todos/:id —— 删除待办（已完成的也可删） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(
      `delete from todos where id = $1 and user_id = $2 returning id, title`,
      [id, user.id],
    )
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "待办不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, title: deleted.title });
}
