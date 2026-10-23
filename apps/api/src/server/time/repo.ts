/**
 * time 域 repo（REQ-004 批③ FR-B1.2）：time_blocks / activities / 时长聚合 SQL 唯一发生地。
 * 只做数据访问，不做业务判断；动态 set 列名全部来自代码内字面量（参数化值）。
 */
import { pool } from "@/server/platform/db";

/** 动态 update 的字段集：列名 → 值（顺序即占位符顺序） */
export type UpdateField = readonly [column: string, value: unknown];

function toSetClauses(fields: readonly UpdateField[]) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, v] of fields) {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  return { sets, vals };
}

export const blocksRepo = {
  /** 单块的现有起止（重叠校验的基准）；可传事务 client 在锁内读，避免基准与落库间被并发改写。
   *  sleep_log_id 随行返回：updateBlock 据此对同步块置空链接（任何编辑即解绑） */
  async timesOf(id: string, userId: string, exec: Pick<typeof pool, "query"> = pool) {
    return (
      await exec.query(`select start_at, end_at, sleep_log_id from time_blocks where id = $1 and user_id = $2`, [id, userId])
    ).rows[0];
  },
  insert(userId: string, activityId: string, title: string, startAt: string, endAt: string, exec: Pick<typeof pool, "query"> = pool, sleepLogId?: string) {
    return exec.query(
      `insert into time_blocks (user_id, activity_id, title, start_at, end_at, time_mode, source, sleep_log_id)
       values ($1,$2,$3,$4,$5,'manual','manual',$6) returning *`,
      [userId, activityId, title, startAt, endAt, sleepLogId ?? null],
    );
  },
  /** 睡眠日志当前的同步块（替换式同步的「被替换者」：重叠预检排除自身 + 先删后插） */
  bySleepLog(userId: string, sleepLogId: string, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(`select id, start_at, end_at from time_blocks where user_id = $1 and sleep_log_id = $2`, [
      userId,
      sleepLogId,
    ]);
  },
  /** 删除某睡眠日志的同步块；returning 起止供复盘缓存失效（跨天块双日），口径同 remove */
  removeBySleepLog(userId: string, sleepLogId: string, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(`delete from time_blocks where user_id = $1 and sleep_log_id = $2 returning id, start_at, end_at`, [
      userId,
      sleepLogId,
    ]);
  },
  updateFields(id: string, userId: string, fields: readonly UpdateField[], exec: Pick<typeof pool, "query"> = pool) {
    const { sets, vals } = toSetClauses(fields);
    vals.push(id, userId);
    return exec.query(
      `update time_blocks set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length}
       returning *`,
      vals,
    );
  },
  /** returning 带 start_at/end_at：删除会让复盘水位（max(start_at)）回退，调用方按块起止日显式失效复盘缓存（跨天块双日） */
  remove(id: string, userId: string) {
    return pool.query(`delete from time_blocks where id = $1 and user_id = $2 returning id, start_at, end_at`, [id, userId]);
  },
  /** 区间内原始时间块（跨天块在其覆盖的每一天都返回）；TZ 为北京时区显式切分 */
  listRange(userId: string, tz: string, from: string, to: string) {
    return pool.query(
      `select b.*, a.name as activity_name, a.icon, a.color
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(
              $3::date::timestamp at time zone $2,
              ($4::date + 1)::timestamp at time zone $2)
       order by b.start_at`,
      [userId, tz, from, to],
    );
  },
};

/** 区间内是否有时间块以外的可复盘数据（动态/非草稿流水/已完成 todo/人际往来，口径对齐复盘管线取数）。
 *  复盘卡「有记录」判定用：只记了账或心情而没记时间块的日子/周，生成按钮不应被禁。
 *  二十轮补 interactions：人际域支持无动态的独立往来（entry_id 为空、可补历史日），
 *  复盘管线把人际互动计为事实行——漏查会让「只有手工往来」的日子误判为无可复盘。
 *  界谓词用 sargable 写法（列裸比较，走 idx_*_user_time 前导索引）：
 *  旧 `(col at time zone $2)::date between` 对列套表达式，每次区间查询顺序扫描用户全量数据 */
export async function hasReviewablesInRange(userId: string, tz: string, from: string, to: string) {
  const { rows } = await pool.query(
    `select exists (select 1 from entries where user_id = $1 and created_at >= $3::date::timestamp at time zone $2 and created_at < ($4::date + 1)::timestamp at time zone $2)
      or exists (select 1 from transactions where user_id = $1 and is_draft = false and occurred_at >= $3::date::timestamp at time zone $2 and occurred_at < ($4::date + 1)::timestamp at time zone $2)
      or exists (select 1 from todos where user_id = $1 and status = 'done' and done_at >= $3::date::timestamp at time zone $2 and done_at < ($4::date + 1)::timestamp at time zone $2)
      or exists (select 1 from interactions where user_id = $1 and occurred_at >= $3::date::timestamp at time zone $2 and occurred_at < ($4::date + 1)::timestamp at time zone $2)
      as has_extras`,
    [userId, tz, from, to],
  );
  return rows[0]?.has_extras === true;
}

export const activitiesRepo = {
  listByUser(userId: string) {
    return pool.query(`select * from activities where user_id = $1 order by sort_order, created_at`, [userId]);
  },
  create(
    userId: string,
    p: { name: string; icon: string; color: string; defaultMin: number },
  ) {
    return pool.query(
      `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
               (select coalesce(max(sort_order), 0) + 1 from activities where user_id = $1), false)
       returning *`,
      [userId, p.name, p.icon, p.color, p.defaultMin],
    );
  },
  updateFields(id: string, userId: string, fields: readonly UpdateField[]) {
    const { sets, vals } = toSetClauses(fields);
    vals.push(id, userId);
    return pool.query(
      `update activities set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
      vals,
    );
  },
  /** 删除自定义分类（其时间块/待办归入"其他"）：事务返回 deleted/not_found/preset 供 service 映射 */
  async deleteCustom(id: string, userId: string): Promise<"deleted" | "not_found" | "preset"> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const act = (
        await client.query(`select * from activities where id = $1 and user_id = $2`, [id, userId])
      ).rows[0];
      if (!act) {
        await client.query("rollback");
        return "not_found";
      }
      if (act.is_preset) {
        await client.query("rollback");
        return "preset";
      }
      await client.query(`update time_blocks set activity_id = 'other' where activity_id = $1 and user_id = $2`, [id, userId]);
      await client.query(`update todos set activity_id = 'other' where activity_id = $1 and user_id = $2`, [id, userId]);
      await client.query(`delete from activities where id = $1 and user_id = $2`, [id, userId]);
      await client.query("commit");
      return "deleted";
    } catch (e) {
      // 连接已坏时 rollback 会抛错顶替原始异常（全站同口径：.catch 不顶替）
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
};

export const statsRepo = {
  /** 按天交集钳制的时长聚合：跨天块分摊到覆盖的每一天 */
  dailyMinsByActivity(userId: string, tz: string, from: string, to: string) {
    return pool.query(
      `select to_char(d.day, 'YYYY-MM-DD') as date,
              b.activity_id,
              sum(floor(extract(epoch from least((b.end_at at time zone $2), (d.day + interval '1 day'))
                               - greatest((b.start_at at time zone $2), d.day)) / 60))::int as mins
       from time_blocks b
       join lateral generate_series(
              greatest(date_trunc('day', b.start_at at time zone $2), $3::date::timestamp),
              least(date_trunc('day', b.end_at at time zone $2), $4::date::timestamp),
              interval '1 day') d(day) on true
       where b.user_id = $1
         and b.start_at < (($5::date + interval '1 day') at time zone $2)
         and b.end_at >= ($6::date at time zone $2)
         and least((b.end_at at time zone $2), (d.day + interval '1 day')) > greatest((b.start_at at time zone $2), d.day)
       group by 1, 2`,
      // 区间条件显式下推到 where（块级：与 lateral 参与条件等价：trunc(start_at) ≤ to 且 trunc(end_at) ≥ from），
      // 让 (user_id, start_at) 索引能按区间剪枝——旧写法区间条件只在 lateral 里，
      // 月/年热力图每次请求都扫用户全量时间块
      [userId, tz, from, to, to, from],
    );
  },
};
