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

/** 北京日历日序号（UTC+8 推算，禁本地 getter；跨设备「今天/昨天」分组与到期差都用它） */
export function bjDayIdx(t: number): number {
  return Math.floor((t + 8 * 3600_000) / 86_400_000);
}

/** ISO → 北京日历日键 YYYY-MM-DD（= web bjDateKey；localDateKey 是宿主时区口径，跨设备日界错位） */
export function bjDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 当前北京时刻的分钟数（时间轴红线等；禁本地 getter） */
export function bjNowMin(): number {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// ===== 北京墙上时间（= web lib/bj-time 单源，REQ-009 9-C 起多份副本收敛于此） =====

/** ISO → 北京时间 HH:MM（UTC getter + 8h；本地 getter 在非中国时区设备会错 8 小时） */
export function zhTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 用原块北京日期 + 新的 HH:MM 组装 ISO（改时间只换钟点、日期不动；本地 setHours 会存错 8 小时） */
export function combineHM(originalIso: string, hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  // 非法输入（空串/残缺 "HH:"）不再让 setUTCHours(NaN) 产生 Invalid Date → toISOString 抛错砸穿 UI
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return originalIso;
  const d = new Date(new Date(originalIso).getTime() + 8 * 3600_000);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** ISO → 北京墙上时间输入值 YYYY-MM-DDTHH:mm（编辑框回填用） */
export function isoToBjInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 北京墙上时间输入值 → ISO（显式 +08:00 解析；裸串按宿主时区解释会偏 8 小时） */
export function bjInputToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.length === 16 ? `${v}:00+08:00` : `${v}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
