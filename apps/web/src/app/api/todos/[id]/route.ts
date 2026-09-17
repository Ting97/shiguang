import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";

export const runtime = "nodejs";

/** PATCH /api/todos/:id  { done: true } —— 勾选完成：标记 done 并生成对应日程时间块 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { done?: boolean };
  if (body.done !== true) {
    return NextResponse.json({ error: "仅支持 { done: true }" }, { status: 400 });
  }

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
    await client.query(
      `update todos set done_entry_id = $2 where id = $1`,
      [todo.id, block.entry_id],
    );

    await client.query("commit");
    return NextResponse.json({ todo, block });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
