import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";

export const runtime = "nodejs";

/**
 * DELETE /api/feed/[id] —— 删除一条动态及其全部识别产物
 * （entries 对子表多为 on delete set null，故按依赖顺序显式清理，避免留下孤儿日程/待办）
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [id, DEV_USER_ID]);
    await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, DEV_USER_ID]);
    await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, DEV_USER_ID]);
    await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, DEV_USER_ID]);
    const { rowCount } = await client.query(
      `delete from entries where id = $1 and user_id = $2`, // voice_logs 级联删除
      [id, DEV_USER_ID],
    );
    if (!rowCount) {
      await client.query("rollback");
      return NextResponse.json({ error: "动态不存在" }, { status: 404 });
    }
    await client.query("commit");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
