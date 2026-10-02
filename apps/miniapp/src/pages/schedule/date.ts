/**
 * 日程页局部日期/时间工具 = web lib/date + lib/bj-time 的合集约搬（禁改 src/lib，故落页面目录）。
 * 全部走北京时区（UTC+8）口径：本地 getter 在海外设备会把日界/时刻错 8 小时（web 源码同款注释）。
 */

const pad = (n: number) => String(n).padStart(2, "0");

/* ---------- 本地日历算术（周界/翻月用，web lib/date 前半段） ---------- */

/** YYYY-MM-DD → 当天 0 点 Date（避开 ISO 裸串被宿主时区解析的坑） */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → YYYY-MM-DD */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/* ---------- 北京时区（UTC+8）日历日：不依赖宿主时区（web lib/date 后半段） ---------- */

/** 当前北京日历日 YYYY-MM-DD */
export function bjToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 北京日历日加 n 天（纯字符串日推进，年视图热力图逐格走日用） */
export function bjAddDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 北京日历日所属周的周一（周一为周界） */
export function bjMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** ISO → 北京日历日键 YYYY-MM-DD（周视图归列用；宿主时区口径会日界错位） */
export function bjDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/* ---------- 北京墙上时间（web lib/bj-time 单源） ---------- */

/** ISO → 北京 HH:MM */
export function zhTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 用原块北京日期 + 新的 HH:MM 组装 ISO（保存编辑块用；本地 setHours 会存出错 8 小时的时刻） */
export function combineHM(originalIso: string, hm: string): string {
  const d = new Date(new Date(originalIso).getTime() + 8 * 3600_000);
  const [h, m] = hm.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** ISO → 北京墙上时间输入值 YYYY-MM-DDTHH:mm（todo 截止编辑框用） */
export function isoToBjInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 北京墙上时间输入值 → ISO（显式 +08:00 解析：裸串按宿主时区解释会偏 8 小时） */
export function bjInputToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.length === 16 ? `${v}:00+08:00` : `${v}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** 当前北京时刻的分钟数（时间轴红线用；禁本地 getter） */
export function bjNowMin(): number {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
