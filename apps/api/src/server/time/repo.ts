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
  /** 单块的现有起止（重叠校验的基准） */
  async timesOf(id: string, userId: string) {
    return (
      await pool.query(`select start_at, end_at from time_blocks where id = $1 and user_id = $2`, [id, userId])
    ).rows[0];
  },
  insert(userId: string, activityId: string, title: string, startAt: string, endAt: string) {
    return pool.query(
      `insert into time_blocks (user_id, activity_id, title, start_at, end_at, time_mode, source)
       values ($1,$2,$3,$4,$5,'manual','manual') returning *`,
      [userId, activityId, title, startAt, endAt],
    );
  },
  updateFields(id: string, userId: string, fields: readonly UpdateField[]) {
    const { sets, vals } = toSetClauses(fields);
    vals.push(id, userId);
    return pool.query(
      `update time_blocks set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length}
       returning *`,
      vals,
    );
  },
  remove(id: string, userId: string) {
    return pool.query(`delete from time_blocks where id = $1 and user_id = $2 returning id`, [id, userId]);
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
      await client.query("rollback");
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
         and least((b.end_at at time zone $2), (d.day + interval '1 day')) > greatest((b.start_at at time zone $2), d.day)
       group by 1, 2`,
      [userId, tz, from, to],
    );
  },
};
