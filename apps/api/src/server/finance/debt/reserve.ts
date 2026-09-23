/**
 * R3 每月备付追踪（REQ-005 FR-3.x）：
 * - reserveOverview：当月应还（月供 + 当月到期本金）按账户名合并 + 勾选状态 + 储蓄覆盖
 * - setReserveCheck / setReserveAll：单项与一键勾选（幂等 upsert / 删行）
 * - autoCheckAfterPayment：记还款后 ≥ 当月应还 → 自动勾选（可手动覆盖）
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { bjToday } from "@shiguangri/shared/date";

export interface ReserveRow {
  liabilityId: string;
  name: string;
  payDays: number[];
  pay: number; // 月供（分）
  extra: number; // 当月到期本金（分）
  need: number;
  checked: boolean;
}

/** 北京时区当月首日（YYYY-MM-01） */
export function currentMonthFirst(): string {
  return `${bjToday().slice(0, 7)}-01`;
}

/** pg 的 date 列返回「宿主本地零点」的 Date（CST 宿主 = 前一日 16:00Z，直接 toISOString 会切出前一天）
 * —— 统一 +8h 归一化后再切北京日历日（与 debts.ts serializeDebt 同口径）；字符串入参按 YYYY-MM-DD 前缀取 */
function isoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return new Date(v.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function ymToFirst(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw ApiError.badRequest("ym 需为 YYYY-MM");
  return `${ym}-01`;
}

export async function reserveOverview(userId: string, ym: string) {
  const ymFirst = ymToFirst(ym);
  const ymNext = nextMonth(ymFirst);
  const { rows: liabilities } = await pool.query(
    `select id, name, monthly_cents, pay_day, due_date, balance_cents
     from liabilities where user_id = $1 and status = 'active'
     order by priority asc nulls last, name asc`,
    [userId],
  );

  // 合并行：同账户（name）合并 need（还款日合并去重升序）
  const merged = new Map<string, ReserveRow>();
  for (const l of liabilities) {
    const pay = Number(l.monthly_cents ?? 0);
    const due = isoDate(l.due_date);
    const extra = due && due >= ymFirst && due < ymNext ? Number(l.balance_cents ?? 0) : 0;
    const row: ReserveRow = merged.get(l.name) ?? {
      liabilityId: l.id,
      name: l.name,
      payDays: [],
      pay: 0,
      extra: 0,
      need: 0,
      checked: false,
    };
    row.pay += pay;
    row.extra += extra;
    row.need += pay + extra;
    if (l.pay_day != null && !row.payDays.includes(Number(l.pay_day))) row.payDays.push(Number(l.pay_day));
    merged.set(l.name, row);
  }
  const list = [...merged.values()].sort((a, b) => b.need - a.need);

  const { rows: checks } = await pool.query(
    `select liability_id from debt_reserve_checks where user_id = $1 and ym = $2`,
    [userId, ymFirst],
  );
  const checkedSet = new Set(checks.map((r) => String(r.liability_id)));
  for (const row of list) {
    // 合并行勾选 = 组内任一负债已勾选：autoCheckAfterPayment 落库的可能是组内非首笔
    // liabilityId，只认首笔会把已勾选显示成未勾、checkedNeed 漏计
    row.checked = liabilities.filter((l) => l.name === row.name).some((l) => checkedSet.has(String(l.id)));
  }

  // 合并行勾选 = 该名称下任一负债已勾选；liabilityIds 供一键/单项落库
  const items = list.map((row) => {
    const ids = liabilities.filter((l) => l.name === row.name).map((l) => l.id);
    return { ...row, liabilityIds: ids };
  });

  const totalNeed = items.reduce((s, r) => s + r.need, 0);
  const checkedNeed = items.filter((r) => r.checked).reduce((s, r) => s + r.need, 0);

  const { rows: savingsRows } = await pool.query(
    `select coalesce(sum(
       a.opening_balance_cents + coalesce((
         select sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end)
         from transactions t where t.account_id = a.id and t.is_draft = false
       ), 0)
     ), 0)::bigint as savings
     from accounts a where a.user_id = $1 and a.reserve_tracked = true and a.archived = false`,
    [userId],
  );
  const savingsCents = Number(savingsRows[0]?.savings ?? 0);

  return {
    ym,
    items,
    totalNeed,
    checkedNeed,
    savingsCents,
    coveragePct: totalNeed > 0 ? Math.round((savingsCents / totalNeed) * 100) : null,
  };
}

function nextMonth(ymFirst: string): string {
  const [y, m] = ymFirst.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export async function setReserveCheck(
  userId: string,
  body: { ym: string; liabilityId?: string; all?: boolean; checked: boolean },
) {
  const ymFirst = ymToFirst(body.ym);
  if (body.all !== undefined) {
    const { rows } = await pool.query(
      `select id from liabilities where user_id = $1 and status = 'active'`,
      [userId],
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const r of rows) {
        if (body.checked) {
          await client.query(
            `insert into debt_reserve_checks (user_id, ym, liability_id) values ($1,$2,$3)
             on conflict (user_id, ym, liability_id) do nothing`,
            [userId, ymFirst, r.id],
          );
        } else {
          await client.query(`delete from debt_reserve_checks where user_id = $1 and ym = $2 and liability_id = $3`, [
            userId,
            ymFirst,
            r.id,
          ]);
        }
      }
      await client.query("commit");
      return { ok: true, count: rows.length };
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  if (!body.liabilityId) throw ApiError.badRequest("liabilityId 必填");
  const own = await pool.query(`select 1 from liabilities where id = $1 and user_id = $2`, [
    body.liabilityId,
    userId,
  ]);
  if (!own.rows[0]) throw ApiError.notFound("负债不存在");
  if (body.checked) {
    await pool.query(
      `insert into debt_reserve_checks (user_id, ym, liability_id) values ($1,$2,$3)
       on conflict (user_id, ym, liability_id) do nothing`,
      [userId, ymFirst, body.liabilityId],
    );
  } else {
    await pool.query(`delete from debt_reserve_checks where user_id = $1 and ym = $2 and liability_id = $3`, [
      userId,
      ymFirst,
      body.liabilityId,
    ]);
  }
  return { ok: true };
}

/** FR-3.4 还款联动：该负债当月（北京）已还合计 ≥ need → 自动勾选（幂等；手动取消后仍会被下次还款重新勾上，可接受） */
export async function autoCheckAfterPayment(userId: string, liabilityId: string, paidCents: number) {
  const ymFirst = currentMonthFirst();
  const l = (
    await pool.query(
      `select monthly_cents, balance_cents, due_date from liabilities where id = $1 and user_id = $2`,
      [liabilityId, userId],
    )
  ).rows[0];
  if (!l) return;
  // due_date 是 date 列 → Date 对象：String() 得到 "Mon Jun 03..." 脏串，必须 +8h 归一化成 YYYY-MM-DD 再比
  const due = isoDate(l.due_date);
  const ymNext = nextMonth(ymFirst);
  const extra = due && due >= ymFirst && due < ymNext ? Number(l.balance_cents ?? 0) : 0;
  const need = Number(l.monthly_cents ?? 0) + extra;
  // 月度合计口径（FR-3.4 语义是「当月已还合计 ≥ need」）：单笔 paidCents 比较会把同月多笔小额还款漏勾。
  // 调用方在还款提交后触发，当月合计通常已含本笔；max 兜底兼容合计尚未含本笔的调用时点
  const monthPaid = Number(
    (
      await pool.query(
        `select coalesce(sum(amount_cents), 0)::bigint as paid from liability_payments
         where liability_id = $1 and user_id = $2
           and to_char((paid_at at time zone 'Asia/Shanghai'), 'YYYY-MM') = $3`,
        [liabilityId, userId, ymFirst.slice(0, 7)],
      )
    ).rows[0]?.paid ?? 0,
  );
  if (need <= 0 || Math.max(monthPaid, paidCents) < need) return;
  await pool.query(
    `insert into debt_reserve_checks (user_id, ym, liability_id) values ($1,$2,$3)
     on conflict (user_id, ym, liability_id) do nothing`,
    [userId, ymFirst, liabilityId],
  );
}
