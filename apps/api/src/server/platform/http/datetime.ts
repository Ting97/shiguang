/**
 * 请求级日期时间严格校验（REQ-004 QA 验收修复）：
 * 只做形状校验（正则）会让 2025-13-01 / T25:99 进入 SQL cast 抛 500——
 * 这里统一「可解析 + 数值合理」双重校验，路由在触碰 SQL 前调用。
 */

/** ISO 时刻串是否严格可解析（Date.parse 拒绝 25:99 等）且含时区/时间语义 */
export function isParsableMoment(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

/** YYYY-MM-DD 是否为真实存在的日历日（拒绝 2025-13-01、2025-02-30） */
export function isValidCalendarDate(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
