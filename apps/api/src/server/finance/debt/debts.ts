/** 负债档案字段校验（debts 路由共用；route 文件不可导出非 handler，故放这里） */
import { isValidCalendarDate } from "@/server/platform/http/datetime";

/** bigint/numeric 列在 node-pg 返回 string，date 列返回 Date 对象 —— 统一转 number/字符串再下发 */
export function serializeDebt(row: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const dateStr = (v: unknown) =>
    v instanceof Date
      ? new Date(v.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
      : v == null
        ? null
        : String(v).slice(0, 10);
  return {
    ...row,
    principal_cents: num(row.principal_cents),
    balance_cents: num(row.balance_cents),
    monthly_cents: num(row.monthly_cents),
    rate_pct: num(row.rate_pct),
    paid_cents: num(row.paid_cents) ?? undefined,
    due_date: dateStr(row.due_date),
    paid_at: dateStr(row.paid_at),
  };
}

export function serializePayment(row: Record<string, unknown>) {
  return { ...row, amount_cents: Number(row.amount_cents) };
}

export function validateDebtBody(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const need = (v: unknown) => v !== undefined || !partial;

  if (need(body.name)) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 40) throw { message: "名称需为 1~40 字" };
    out.name = name;
  }
  if (need(body.type)) {
    if (!["credit_card", "mortgage", "car_loan", "consumer_loan", "bnpl", "family"].includes(body.type as string))
      throw { message: "无效的负债类型" };
    out.type = body.type;
  }
  if (need(body.principalCents)) {
    const v = body.principalCents;
    if (!Number.isInteger(v) || (v as number) < 0) throw { message: "本金需为不小于 0 的整数（分）" };
    out.principal_cents = v;
  }
  if (body.balanceCents !== undefined) {
    const v = body.balanceCents;
    if (!Number.isInteger(v) || (v as number) < 0) throw { message: "当前余额需为不小于 0 的整数（分）" };
    out.balance_cents = v;
  }
  if (body.ratePct !== undefined) {
    const v = Number(body.ratePct);
    if (!Number.isFinite(v) || v < 0 || v > 36) throw { message: "年化利率需在 0~36 之间" };
    out.rate_pct = Math.round(v * 100) / 100;
  }
  if (body.monthlyCents !== undefined) {
    const v = body.monthlyCents;
    if (v === null) out.monthly_cents = null;
    else if (!Number.isInteger(v) || (v as number) <= 0) throw { message: "月供需为正整数（分）或空" };
    else out.monthly_cents = v;
  }
  if (body.payDay !== undefined) {
    const v = body.payDay;
    if (v === null) out.pay_day = null;
    else if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 31)
      throw { message: "还款日需为 1~31 或空" };
    else out.pay_day = v;
  }
  if (body.dueDate !== undefined) {
    const v = body.dueDate;
    if (v === null || v === "") out.due_date = null;
    // 形状合法但非真实日历日（2024-13-01）曾穿透到 PG date 列抛 500，这里双重校验
    else if (typeof v !== "string" || !isValidCalendarDate(v)) throw { message: "到期日需为真实存在的日期（YYYY-MM-DD）" };
    else out.due_date = v;
  }
  if (body.priority !== undefined) {
    const v = body.priority;
    // priority 为 int4：只验整数会放行 1e12 → 22003 → 500，按业务语义限 0~99
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 99) {
      throw { message: "优先级需为 0~99 的整数" };
    }
    out.priority = v;
  }
  if (body.note !== undefined) {
    const v = body.note;
    if (v !== null && typeof v !== "string") throw { message: "备注需为文本" };
    out.note = v ? String(v).slice(0, 200) : null;
  }
  return out;
}
