import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ruleMood } from "@shiguangri/ai";

export const runtime = "nodejs";

/** PATCH /api/feed/:id —— 修正动态的心情（{ mood: 心情词 | null }；null=清除）；情绪分按心情词基准分补全 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { mood?: string | null };

  const label = body.mood?.trim() || null;
  const score = label ? (ruleMood(label)?.score ?? 0) : null;

  const updated = (
    await pool.query(
      `update entries set mood = $1, mood_score = $2
       where id = $3 and user_id = $4 returning id, mood, mood_score`,
      [label, score, id, user.id],
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "动态不存在" }, { status: 404 });
  return NextResponse.json({ entry: updated });
}

/**
 * DELETE /api/feed/[id] —— 删除一条动态及其全部识别产物
 * （entries 对子表多为 on delete set null，故按依赖顺序显式清理，避免留下孤儿日程/待办）
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
    const { rowCount } = await client.query(
      `delete from entries where id = $1 and user_id = $2`, // voice_logs 级联删除
      [id, user.id],
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
