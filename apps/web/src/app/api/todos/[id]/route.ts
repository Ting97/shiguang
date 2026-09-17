import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";

export const runtime = "nodejs";

/** PATCH /api/todos/:id —— { done: true } 勾选完成（生成日程块）；或传字段修改待办 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    done?: boolean;
    title?: string;
    dueAt?: string | null; // ISO；null=清除时间
    activityId?: string;
  };

  // ---- 模式一：勾选完成 ----
  if (body.done === true) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const todo = (
        await client.query(
          `update todos set status = 'done', done_at = now()
           where id = $1 and user_id = $2 and status = 'pending' returning *`,
          [id, DEV_USER_ID],
        )
      ).rows[0];
      if (!todo) {
        await client.query("rollback");
        return NextResponse.json({ error: "待办不存在或已完成" }, { status: 404 });
      }

      // 完成即记录：以类别默认时长回填一个时间块（结束于当下）
      const dur = (
        await client.query("select default_min from activities where id = $1", [todo.activity_id])
      ).rows[0]?.default_min ?? 30;
      const block = (
        await client.query(
          `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
           values ($1,$2,$3,$4, now() - ($5 || ' minutes')::interval, now(), 'default', 'manual')
           returning *`,
          [DEV_USER_ID, todo.entry_id, todo.activity_id, todo.title, dur],
        )
      ).rows[0];
      await client.query(`update todos set done_entry_id = $2 where id = $1`, [
        todo.id,
        block.entry_id,
      ]);

      await client.query("commit");
      return NextResponse.json({ todo, block });
    } catch (e) {
      await client.query("rollback");
      return NextResponse.json({ error: String(e) }, { status: 500 });
    } finally {
      client.release();
    }
  }

  // ---- 模式二：修改字段 ----
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.title != null) { vals.push(body.title.trim()); sets.push(`title = $${vals.length}`); }
  if (body.dueAt !== undefined) {
    vals.push(body.dueAt); // null 允许，清除时间
    sets.push(`due_at = $${vals.length}::timestamptz`);
    sets.push(`remind_at = ($${vals.length}::timestamptz - interval '15 minutes')`);
  }
  if (body.activityId != null) { vals.push(body.activityId); sets.push(`activity_id = $${vals.length}`); }
  if (sets.length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  vals.push(id, DEV_USER_ID);
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
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(
      `delete from todos where id = $1 and user_id = $2 returning id, title`,
      [id, DEV_USER_ID],
    )
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "待办不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, title: deleted.title });
}
