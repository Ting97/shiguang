/** 日期工具（全部基于本地时区） */

export const pad = (n: number) => String(n).padStart(2, "0");

/** Date → YYYY-MM-DD */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return ymd(new Date());
}

/** ISO 时间戳 → 本地日期键 YYYY-MM-DD（严禁用 iso.slice(0,10)，那是 UTC 日期） */
export function localDateKey(iso: string): string {
  return ymd(new Date(iso));
}

/** YYYY-MM-DD → Date（当天 0 点，避开 ISO 解析的时区坑） */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 本周一（周一为一周开始） */
export function startOfWeek(s: string): string {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

export function startOfMonth(s: string): string {
  return s.slice(0, 8) + "01";
}

export function startOfYear(s: string): string {
  return s.slice(0, 4) + "-01-01";
}

const WEEK_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function weekName(s: string): string {
  return WEEK_NAMES[(parseYmd(s).getDay() + 6) % 7];
}

/** 2026-09-17 → "9月17日" */
export function zhDate(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 分钟 → "3小时20分" / "45分钟" */
export function zhDuration(min: number): string {
  if (min <= 0) return "0分钟";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

// ===== 北京时区（UTC+8）日历日工具：不依赖宿主时区（004 FR-B2.1 单源化，REQ-003 起的多份副本收敛于此） =====

/** 当前北京日历日 YYYY-MM-DD */
export function bjToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 北京日历日加 n 天 */
export function bjAddDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 北京日历日所属周的周一（周一为周界） */
export function bjMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
