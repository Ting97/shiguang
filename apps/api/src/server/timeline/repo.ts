/** timeline 域 repo：entries/识别登记簿/子表 SQL 唯一发生地（REQ-004 FR-B1.2） */
import { pool } from "@/server/platform/db";

export const entriesRepo = {
  async rawTextOf(entryId: string, userId: string, client: import("pg").PoolClient | typeof pool = pool): Promise<{ raw_text: string; created_at: string | Date } | undefined> {
    // 事务内首条语句用 for update：所有写路径统一「先锁 entry 行再动子表」的加锁顺序，
    // 与 analyzeAndPersist（select for update → 清旧插新）互斥串行，避免 patch/delete 与
    // 后台补跑识别对 entries/子表反序加锁触发 PG deadlock（services-smoke 偶发复现）
    return (
      await client.query(`select raw_text, created_at from entries where id = $1 and user_id = $2 for update`, [entryId, userId])
    ).rows[0];
  },
  insert(userId: string, source: string, text: string) {
    return pool.query(
      `insert into entries (user_id, source, raw_text) values ($1,$2,$3)
       returning id, raw_text, created_at, analyzed_at`,
      [userId, source, text],
    );
  },
  /** 用户在动态上落定数据（确认待确认项/手动补录）即视为已处理：打点 analyzed_at，
   *  巡检不再对这条动态补跑识别——补跑的 clearDerived 会把用户已确认/手动添加的行一并删掉（数据丢失）。
   *  coalesce：识别已打点时保持不变。须在调用方事务内执行（UPDATE 取行锁，与其他写路径「先锁 entry」同序） */
  stampAnalyzedAt(client: import("pg").PoolClient | typeof pool, entryId: string) {
    return client.query(`update entries set analyzed_at = coalesce(analyzed_at, now()) where id = $1`, [entryId]);
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
    // 状态守卫：pending → none 才生效（与 applyRecognition 对称），防并发 confirm 已 applied 后被回写
    return pool.query(`update entry_recognitions set status = 'none', updated_at = now() where id = $1 and status = 'pending'`, [recId]);
  },
  applyRecognition(recId: string, client: import("pg").PoolClient | typeof pool = pool) {
    // 状态守卫：并发双 confirm（pending 快照在事务外读入）只有第一方真正置 applied，防重复落库
    return client.query(`update entry_recognitions set status = 'applied', updated_at = now() where id = $1 and status = 'pending'`, [recId]);
  },
  /** 子表清空（confirm/edit 重写前、DELETE 前共用；顺序即依赖顺序） */
  async clearDerived(client: import("pg").PoolClient, entryId: string, userId: string) {
    // 拆解行动挂在本条动态的识别待办下（parent_todo_id on delete cascade）且自身无 entry_id：
    // 删识别待办前先解挂（parent 置 null），用户手动/AI 拆解加的行动保留，不随识别重写连带清掉
    await client.query(
      `update todos set parent_todo_id = null
       where parent_todo_id in (select id from todos where entry_id = $1 and user_id = $2)`,
      [entryId, userId],
    );
    for (const t of ["interactions", "transactions", "todos", "time_blocks", "diet_records", "entry_recognitions"]) {
      await client.query(`delete from ${t} where entry_id = $1 and user_id = $2`, [entryId, userId]);
    }
  },
  editRawText(client: import("pg").PoolClient, entryId: string, userId: string, text: string) {
    // analyze_retries 同句归零：编辑=新一轮识别（analyzed_at 置 null 触发重识别），
    // 不清零时巡检按旧失败代次的预算拒绝补跑，新文本识别失败后永远没有重试机会
    return client.query(
      `update entries set raw_text = $1, mood = null, mood_score = null, analyzed_at = null, analyze_retries = 0
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
  setSpace(entryId: string, userId: string, spaceId: string | null) {
    return pool.query(`update entries set space_id = $1 where id = $2 and user_id = $3 returning id, space_id`, [
      spaceId, entryId, userId,
    ]);
  },
  spaceOwnerExists(spaceId: string, userId: string) {
    return pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [spaceId, userId]);
  },
  setMoodByEntry(entryId: string, userId: string, label: string | null, score: number | null) {
    // 同句打点 analyzed_at（与 stampAnalyzedAt 同口径）：心情手设/清除 = 用户已落定数据，
    // 否则飞行中/巡检补跑的识别会用 analyze 的无条件心情回写把用户设置覆盖掉（静默丢失）
    return pool.query(
      `update entries set mood = $1, mood_score = $2, analyzed_at = coalesce(analyzed_at, now())
       where id = $3 and user_id = $4 returning id, mood, mood_score`,
      [label, score, entryId, userId],
    );
  },
};
