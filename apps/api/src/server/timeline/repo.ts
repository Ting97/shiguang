/** timeline 域 repo：entries/识别登记簿/子表 SQL 唯一发生地（REQ-004 FR-B1.2） */
import { pool } from "@/server/platform/db";

export const entriesRepo = {
  async rawTextOf(entryId: string, userId: string): Promise<{ raw_text: string } | undefined> {
    return (
      await pool.query(`select raw_text from entries where id = $1 and user_id = $2`, [entryId, userId])
    ).rows[0];
  },
  insert(userId: string, source: string, text: string) {
    return pool.query(
      `insert into entries (user_id, source, raw_text) values ($1,$2,$3)
       returning id, raw_text, created_at, analyzed_at`,
      [userId, source, text],
    );
  },
  setAnalyzedAt(entryId: string) {
    return pool.query(
      `update entries set analyzed_at = now() where id = $1 and analyzed_at is null`,
      [entryId],
    );
  },
  /** 待确认识别结果 */
  async pendingRecognition(entryId: string, userId: string, domain: string) {
    return (
      await pool.query(
        `select id, result from entry_recognitions
         where entry_id = $1 and user_id = $2 and domain = $3 and status = 'pending'`,
        [entryId, userId, domain],
      )
    ).rows[0];
  },
  ignoreRecognition(recId: string) {
    return pool.query(`update entry_recognitions set status = 'none', updated_at = now() where id = $1`, [recId]);
  },
  applyRecognition(recId: string) {
    return pool.query(`update entry_recognitions set status = 'applied', updated_at = now() where id = $1`, [recId]);
  },
  moodOf(entryId: string, userId: string) {
    return pool.query(`select raw_text from entries where id = $1 and user_id = $2`, [entryId, userId]);
  },
  setMood(entryId: string, label: string, score: number) {
    return pool.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [label, score, entryId]);
  },
  /** 子表清空（confirm/edit 重写前、DELETE 前共用；顺序即依赖顺序） */
  async clearDerived(client: import("pg").PoolClient | typeof pool, entryId: string, userId: string) {
    for (const t of ["interactions", "transactions", "todos", "time_blocks", "diet_records", "entry_recognitions"]) {
      await client.query(`delete from ${t} where entry_id = $1 and user_id = $2`, [entryId, userId]);
    }
  },
  editRawText(client: import("pg").PoolClient, entryId: string, userId: string, text: string) {
    return client.query(
      `update entries set raw_text = $1, mood = null, mood_score = null, analyzed_at = null
       where id = $2 and user_id = $3 returning id, raw_text, analyzed_at`,
      [text, entryId, userId],
    );
  },
  async imageKeysOf(client: import("pg").PoolClient, entryId: string, userId: string): Promise<string[]> {
    return (
      await client.query(`select storage_key from entry_images where entry_id = $1 and user_id = $2`, [entryId, userId])
    ).rows.map((r) => r.storage_key);
  },
  deleteEntry(client: import("pg").PoolClient, entryId: string, userId: string) {
    return client.query(`delete from entries where id = $1 and user_id = $2`, [entryId, userId]);
  },
  async ownerExists(entryId: string, userId: string): Promise<boolean> {
    const { rows } = await pool.query(`select id from entries where id = $1 and user_id = $2`, [entryId, userId]);
    return Boolean(rows[0]);
  },
  setSpace(entryId: string, userId: string, spaceId: string | null) {
    return pool.query(`update entries set space_id = $1 where id = $2 and user_id = $3 returning id, space_id`, [
      spaceId, entryId, userId,
    ]);
  },
  spaceOwnerExists(spaceId: string, userId: string) {
    return pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [spaceId, userId]);
  },
  setMoodByEntry(entryId: string, userId: string, label: string | null, score: number | null) {
    return pool.query(
      `update entries set mood = $1, mood_score = $2 where id = $3 and user_id = $4 returning id, mood, mood_score`,
      [label, score, entryId, userId],
    );
  },
};
