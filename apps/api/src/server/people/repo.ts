/**
 * people 域 repo（REQ-004 批③ FR-B1.2）：contacts / interactions / AI 画像 SQL 唯一发生地。
 * 只做数据访问，不做业务判断；动态 set 列名全部来自代码内字面量（参数化值）。
 */
import { pool } from "@/server/platform/db";

/** 动态 update 的字段集：列名 → 值（顺序即占位符顺序） */
export type UpdateField = readonly [column: string, value: unknown];

export const contactsRepo = {
  /** 列表：含互动次数/最近往来/人情往来净额 */
  listWithStats(userId: string) {
    return pool.query(
      `select c.id, c.name, c.alias, c.group_tag,
              to_char(c.birthday, 'YYYY-MM-DD') as birthday,
              c.birthday_cal, c.lunar_month, c.lunar_day, c.lunar_leap,
              to_char(c.anniversary, 'YYYY-MM-DD') as anniversary,
              c.intimacy, c.importance, c.notes, c.created_at,
              (select count(*) from interactions i where i.contact_id = c.id) as interaction_count,
              (select i.occurred_at from interactions i where i.contact_id = c.id
                order by i.occurred_at desc nulls last limit 1) as last_at,
              (select i.summary from interactions i where i.contact_id = c.id
                order by i.occurred_at desc nulls last limit 1) as last_summary,
              (select coalesce(sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end), 0)
                 from transactions t
                where t.user_id = c.user_id and t.counterparty = c.name
                  and t.category = '人情往来' and t.is_draft = false) as gift_net_cents
         from contacts c
        where c.user_id = $1
        order by last_at desc nulls last, c.created_at desc`,
      [userId],
    );
  },
  /** 建档：with ins 返回 birthday/anniversary 用 to_char 转字符串，防 pg date 被序列化成 UTC ISO 退一天 */
  create(
    userId: string,
    p: {
      name: string;
      alias: string | null;
      group: string;
      birthday: string | null;
      birthdayCal: string;
      lunarMonth: number | null;
      lunarDay: number | null;
      lunarLeap: boolean;
      anniversary: string | null;
      importance: number;
      notes: string | null;
    },
  ) {
    return pool.query(
      `with ins as (
         insert into contacts (user_id, name, alias, group_tag, birthday, birthday_cal, lunar_month, lunar_day, lunar_leap, anniversary, importance, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning *
       )
       select ins.*, to_char(ins.birthday, 'YYYY-MM-DD') as birthday,
              to_char(ins.anniversary, 'YYYY-MM-DD') as anniversary
       from ins`,
      [
        userId,
        p.name,
        p.alias,
        p.group,
        p.birthday,
        p.birthdayCal,
        p.lunarMonth,
        p.lunarDay,
        p.lunarLeap,
        p.anniversary,
        p.importance,
        p.notes,
      ],
    );
  },
  /** TA 的档案基本信息（含 AI 画像缓存与生成时间） */
  async detailById(id: string, userId: string) {
    return (
      await pool.query(
        `select id, name, alias, group_tag,
                to_char(birthday, 'YYYY-MM-DD') as birthday,
                birthday_cal, lunar_month, lunar_day, lunar_leap,
                to_char(anniversary, 'YYYY-MM-DD') as anniversary,
                intimacy, importance, notes, created_at, ai_profile, to_char(ai_profile_at, 'YYYY-MM-DD HH24:MI') as ai_profile_at
         from contacts where id = $1 and user_id = $2`,
        [id, userId],
      )
    ).rows[0];
  },
  async existsById(id: string, userId: string) {
    return (
      await pool.query(`select id from contacts where id = $1 and user_id = $2`, [id, userId])
    ).rows[0];
  },
  updateFields(id: string, userId: string, fields: readonly UpdateField[]) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [col, v] of fields) {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    }
    vals.push(id, userId);
    return pool.query(
      `with upd as (
         update contacts set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length}
         returning *
       )
       select upd.*, to_char(upd.birthday, 'YYYY-MM-DD') as birthday,
              to_char(upd.anniversary, 'YYYY-MM-DD') as anniversary
       from upd`,
      vals,
    );
  },
  remove(id: string, userId: string) {
    return pool.query(`delete from contacts where id = $1 and user_id = $2 returning id`, [id, userId]);
  },
  /** 一起经历过的事：往来事件（含来源动态原文与关联流水金额） */
  timelineOf(contactId: string) {
    return pool.query(
      `select i.id, i.type, i.summary, i.occurred_at, i.created_at,
              e.raw_text as entry_text,
              t.amount_cents as tx_amount_cents, t.direction as tx_direction, t.category as tx_category
         from interactions i
         left join entries e on e.id = i.entry_id
         left join transactions t on t.id = i.tx_id
        where i.contact_id = $1
        order by coalesce(i.occurred_at, i.created_at) desc
        limit 100`,
      [contactId],
    );
  },
  /** 关联人情账：流水的「对方」字段命中联系人名（含语音/手动/导入，草稿除外） */
  moneyOf(userId: string, name: string) {
    return pool.query(
      `select id, direction, amount_cents, category, note, occurred_at
         from transactions
        where user_id = $1 and counterparty = $2 and category = '人情往来' and is_draft = false
        order by occurred_at desc nulls last
        limit 50`,
      [userId, name],
    );
  },
  /** AI 画像缓存只读 */
  async aiProfileOf(id: string, userId: string) {
    return (
      await pool.query(`select ai_profile, ai_profile_at from contacts where id = $1 and user_id = $2`, [id, userId])
    ).rows[0];
  },
  /** 画像提炼的档案输入 */
  async profileInputById(id: string, userId: string) {
    return (
      await pool.query(
        `select id, name, alias, group_tag, birthday, anniversary, importance, notes
         from contacts where id = $1 and user_id = $2`,
        [id, userId],
      )
    ).rows[0];
  },
  setAiProfile(id: string, userId: string, profileJson: string) {
    return pool.query(
      `update contacts set ai_profile = $3, ai_profile_at = now() where id = $1 and user_id = $2
       returning ai_profile, ai_profile_at`,
      [id, userId, profileJson],
    );
  },
};

export const interactionsRepo = {
  create(userId: string, contactId: string, type: string, summary: string | null, occurredAtIso: string) {
    return pool.query(
      `insert into interactions (user_id, contact_id, type, summary, occurred_at)
       values ($1, $2, $3, $4, $5) returning *`,
      [userId, contactId, type, summary, occurredAtIso],
    );
  },
  listByContact(userId: string, contactId: string) {
    return pool.query(
      `select id, type, summary, occurred_at, entry_id, created_at
       from interactions where user_id = $1 and contact_id = $2
       order by occurred_at desc, created_at desc`,
      [userId, contactId],
    );
  },
  updateFields(id: string, userId: string, sets: readonly string[], vals: readonly unknown[]) {
    return pool.query(
      `update interactions set ${sets.join(", ")} where id = $${vals.length + 1} and user_id = $${vals.length + 2} returning *`,
      [...vals, id, userId],
    );
  },
  remove(id: string, userId: string) {
    return pool.query(`delete from interactions where id = $1 and user_id = $2 returning id`, [id, userId]);
  },
  /** 画像提炼的往来记录输入（最近 50 条） */
  recentForProfile(contactId: string, userId: string) {
    return pool.query(
      `select type, summary, occurred_at from interactions
       where contact_id = $1 and user_id = $2 order by occurred_at desc nulls last limit 50`,
      [contactId, userId],
    );
  },
};

export const peopleMoneyRepo = {
  /** 画像提炼的人情账输入（最近 30 笔；参数顺序沿用原 SQL：$1 对方、$2 用户） */
  recentForProfile(name: string, userId: string) {
    return pool.query(
      `select direction, amount_cents, category, note, occurred_at from transactions
       where user_id = $2 and is_draft = false and counterparty = $1
       order by occurred_at desc limit 30`,
      [name, userId],
    );
  },
};
