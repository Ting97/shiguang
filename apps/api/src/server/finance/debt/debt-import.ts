/**
 * R2 负债数据迁移（REQ-005 FR-2.x）：trade.ting97.cn 导出 JSON → 拾光 liabilities/accounts。
 * dryRun 逐行判重（name+type）+ 前后总额对账；commit 单事务写入（仅勾选项）。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { isValidCalendarDate } from "@/server/platform/http/datetime";

export interface ImportLiabilityRow {
  name: string;
  type: string;
  principalCents: number;
  balanceCents?: number | null;
  ratePct?: number | null;
  monthlyCents?: number | null;
  payDay?: number | null;
  dueDate?: string | null;
  priority?: number | null;
  note?: string | null;
}

export interface ImportAccountRow {
  name: string;
  icon?: string | null;
  openingBalanceCents: number;
}

export interface ImportPayload {
  liabilities: ImportLiabilityRow[];
  accounts: ImportAccountRow[];
}

const DEBT_TYPES = new Set(["credit_card", "mortgage", "car_loan", "consumer_loan", "bnpl", "family"]);

function validateRows(data: ImportPayload) {
  if (!data || !Array.isArray(data.liabilities)) throw ApiError.badRequest("data.liabilities 缺失");
  // 行数上限：防超大 payload 拖垮逐行 insert 事务
  if (data.liabilities.length > 5000) throw ApiError.badRequest("单次最多导入 5000 条");
  data.liabilities.forEach((r, i) => {
    if (!r?.name?.trim() || r.name.length > 40) throw ApiError.badRequest(`第 ${i + 1} 行名称必填且 ≤40 字`);
    if (!DEBT_TYPES.has(r.type)) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）无效的负债类型：${r.type}`);
    if (!Number.isInteger(r.principalCents) || r.principalCents < 0) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）本金需为非负整数（分）`);
    if (r.balanceCents != null && (!Number.isInteger(r.balanceCents) || r.balanceCents < 0)) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）余额需为非负整数（分）`);
    if (r.monthlyCents != null && (!Number.isInteger(r.monthlyCents) || r.monthlyCents < 0)) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）月供需为非负整数（分）`);
    // ratePct/payDay 与 validateDebtBody 同口径：非数值/越界曾穿透到 PG 列约束抛 500
    if (r.ratePct != null) {
      const v = Number(r.ratePct);
      if (!Number.isFinite(v) || v < 0 || v > 36) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）年化利率需在 0~36 之间`);
    }
    if (r.payDay != null && (!Number.isInteger(r.payDay) || (r.payDay as number) < 1 || (r.payDay as number) > 31)) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）还款日需为 1~31 或空`);
    // 形状合法但非真实日历日（2024-13-01）曾穿透到 PG date 列抛 500
    if (r.dueDate != null && !isValidCalendarDate(r.dueDate)) throw ApiError.badRequest(`第 ${i + 1} 行（${r.name}）到期日需为真实存在的日期（YYYY-MM-DD）`);
  });
  if (data.accounts && !Array.isArray(data.accounts)) throw ApiError.badRequest("data.accounts 需为数组");
  (data.accounts ?? []).forEach((a, i) => {
    if (!a?.name?.trim()) throw ApiError.badRequest(`账户第 ${i + 1} 行名称必填`);
    if (!Number.isInteger(a.openingBalanceCents)) throw ApiError.badRequest(`账户第 ${i + 1} 行（${a.name}）期初余额需为整数（分）`);
  });
}

/** 预览/提交共用：判重（name+type）+ 对账口径 */
async function planRows(userId: string, data: ImportPayload) {
  const existing = await pool.query(
    `select name, type, balance_cents from liabilities where user_id = $1`,
    [userId],
  );
  const key = (name: string, type: string) => `${name}||${type}`;
  const existingMap = new Map(existing.rows.map((r) => [key(r.name, r.type), r]));

  const rows = data.liabilities.map((r) => {
    const dup = existingMap.get(key(r.name.trim(), r.type));
    return {
      ...r,
      name: r.name.trim(),
      action: dup ? ("skip" as const) : ("create" as const),
      exists: Boolean(dup),
      existingBalanceCents: dup?.balance_cents ?? null,
    };
  });

  const existingAccounts = await pool.query(`select name from accounts where user_id = $1`, [userId]);
  const accountNames = new Set(existingAccounts.rows.map((r) => r.name));
  const accountRows = (data.accounts ?? []).map((a) => ({
    ...a,
    name: a.name.trim(),
    action: accountNames.has(a.name.trim()) ? ("skip" as const) : ("create" as const),
  }));

  const beforeTotalCents = existing.rows.reduce((s, r) => s + Number(r.balance_cents ?? 0), 0);
  const newTotalCents = rows
    .filter((r) => r.action === "create")
    .reduce((s, r) => s + Number(r.balanceCents ?? r.principalCents ?? 0), 0);
  return {
    rows,
    accountRows,
    summary: {
      beforeTotalCents,
      afterTotalCents: beforeTotalCents + newTotalCents,
      newCount: rows.filter((r) => r.action === "create").length,
      skipCount: rows.filter((r) => r.action === "skip").length,
    },
  };
}

/** dryRun：只读预览（逐行 action + 对账摘要） */
export async function importDebtsPreview(userId: string, data: ImportPayload) {
  validateRows(data);
  const { rows, accountRows, summary } = await planRows(userId, data);
  return { rows, accountRows, summary };
}

/** commit：单事务写入（仅 create 行）；幂等——重复提交时全部 skip 零写入 */
export async function importDebtsCommit(userId: string, data: ImportPayload) {
  validateRows(data);
  const { rows, accountRows, summary } = await planRows(userId, data);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let created = 0;
    for (const r of rows) {
      if (r.action !== "create") continue;
      await client.query(
        `insert into liabilities
           (user_id, name, type, principal_cents, balance_cents, rate_pct, monthly_cents, pay_day, due_date, priority, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          userId,
          r.name,
          r.type,
          r.principalCents,
          r.balanceCents ?? r.principalCents,
          r.ratePct ?? null,
          r.monthlyCents ?? null,
          r.payDay ?? null,
          r.dueDate ?? null,
          r.priority ?? null,
          r.note ?? null,
        ],
      );
      created++;
    }
    let accountsCreated = 0;
    for (const a of accountRows) {
      if (a.action !== "create") continue;
      await client.query(
        `insert into accounts (user_id, name, icon, opening_balance_cents)
         values ($1,$2,coalesce($3,'💰'),$4)`,
        [userId, a.name, a.icon ?? null, a.openingBalanceCents],
      );
      accountsCreated++;
    }
    await client.query("commit");
    return { created, skipped: rows.length - created, accountsCreated, summary };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
