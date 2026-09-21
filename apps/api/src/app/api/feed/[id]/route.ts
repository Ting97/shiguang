import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ruleMood } from "@shiguangri/ai";
import { analyzeAndPersist } from "@/lib/analyze";
import { checkAiQuota } from "@/lib/quota";
import { deleteImageFile } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * PATCH /api/feed/:id —— 动态修正
 * - { mood } 修正心情（原逻辑：null=清除）
 * - { raw_text } 编辑原文：**替换式自动重识别**——清空旧识别产物 → 置 analyzed_at=null（前端进"识别中"态）
 *   → 后台 analyzeAndPersist 全域重识别（同发动态），完成自动打 analyzed_at，无需手动逐域触发
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { mood?: string | null; raw_text?: string };

  if (body.raw_text !== undefined) {
    const text = body.raw_text.trim();
    if (!text) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
    if (text.length > 2000) return NextResponse.json({ error: "动态最长 2000 字" }, { status: 400 });
    const q = await checkAiQuota(user.id);
    if (!q.allowed) {
      return NextResponse.json(
        { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限识别`, quota: q },
        { status: 402 },
      );
    }

    const client = await pool.connect();
    let updated;
    try {
      await client.query("begin");
      // 清理旧识别产物（依赖顺序同 DELETE；心情/识别登记簿随 analyze 重写）
      await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [id, user.id]);
      await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, user.id]);
      await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, user.id]);
      await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
      await client.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [id, user.id]);
      await client.query(`delete from entry_recognitions where entry_id = $1 and user_id = $2`, [id, user.id]);
      updated = (
        await client.query(
          `update entries set raw_text = $1, mood = null, mood_score = null, analyzed_at = null
           where id = $2 and user_id = $3 returning id, raw_text, analyzed_at`,
          [text, id, user.id],
        )
      ).rows[0];
      if (!updated) {
        await client.query("rollback");
        return NextResponse.json({ error: "动态不存在" }, { status: 404 });
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      return NextResponse.json({ error: String(e) }, { status: 500 });
    } finally {
      client.release();
    }
    // 后台全域重识别（同发动态：秒回 + fire-and-forget），成败都打 analyzed_at
    void analyzeAndPersist(user.id, id, text)
      .catch((e) => console.error(`[analyze] entry ${id} 编辑重识别失败:`, e))
      .finally(() =>
        pool.query(`update entries set analyzed_at = now() where id = $1 and analyzed_at is null`, [id]).catch(() => {}),
      );
    return NextResponse.json({ ok: true, entry: updated });
  }

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
    const imageKeys = (
      await client.query(`select storage_key from entry_images where entry_id = $1 and user_id = $2`, [id, user.id])
    ).rows.map((r) => r.storage_key);
    if (imageKeys.length) {
      await client.query(`delete from entry_images where entry_id = $1 and user_id = $2`, [id, user.id]);
    }
    await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [id, user.id]);
    await client.query(`delete from entry_recognitions where entry_id = $1 and user_id = $2`, [id, user.id]);
    const { rowCount } = await client.query(
      `delete from entries where id = $1 and user_id = $2`, // voice_logs 级联删除
      [id, user.id],
    );
    if (!rowCount) {
      await client.query("rollback");
      return NextResponse.json({ error: "动态不存在" }, { status: 404 });
    }
    await client.query("commit");
    // 盘上文件事务外异步清理（失败仅记日志，不阻塞响应）
    for (const k of imageKeys) void deleteImageFile(k);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
