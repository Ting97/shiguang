/**
 * 农历生日支持 —— 公历↔农历换算封装（solarlunar 3.x，覆盖 1900~2100）
 * 民间习俗：闰月生日在无闰月的年份按平月过；三十生日在小月按廿九过
 */

// solarlunar 的 exports 未带 types 条件（node16/bundler 解析下无声明）；仅此一处抑制
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as solarLunarModule from "solarlunar";

// solarlunar 的包形态在 CJS/ESM 互操作下不同（方法可能挂在 .default 上）——取有方法的那层
const solarLunar: any = (solarLunarModule as any).default?.toChinaMonth
  ? (solarLunarModule as any).default
  : (solarLunarModule as any);

export interface LunarBirthday {
  month: number; // 农历月 1~12
  day: number; // 农历日 1~30
  leap: boolean; // 是否闰月（如闰六月初三）
}

/** 农历月中文标签：1→正月 … 12→腊月 */
export const lunarMonthLabel = (m: number): string => solarLunar.toChinaMonth(m);
/** 农历日中文标签：1→初一 … 10→初十 … 20→二十 … 30→三十 */
export const lunarDayLabel = (d: number): string => solarLunar.toChinaDay(d);

/** 农历生日完整标签：闰六月初三 */
export function lunarBirthdayLabel(b: LunarBirthday): string {
  return `${b.leap ? "闰" : ""}${lunarMonthLabel(b.month)}${lunarDayLabel(b.day)}`;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** 把任意时刻归一到「北京日历日」的本地零点 holder（与 lunar2solar 产出的 Date 同口径）：
 *  非 CST 宿主直接用 new Date() 的本地日界当业务日，倒计时会差一天（007 检视记录的同型残留） */
function bjCalToday(today: Date): Date {
  const shifted = new Date(today.getTime() + 8 * 3600_000);
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** 农历月日 → 某年公历日期；该年无此闰月/该月是小月没有这天 → 回落平月/廿九；仍失败返回 null */
function lunarToSolarInYear(b: LunarBirthday, year: number, leap: boolean): Date | null {
  const r = solarLunar.lunar2solar(year, b.month, b.day, leap);
  if (r !== -1) return new Date(r.cYear, r.cMonth - 1, r.cDay);
  const r29 = solarLunar.lunar2solar(year, b.month, Math.min(b.day, 29), leap);
  return r29 === -1 ? null : new Date(r29.cYear, r29.cMonth - 1, r29.cDay);
}

/** 农历生日 → 下一次过生日对应的公历日期（含今天） */
export function nextLunarBirthdaySolar(b: LunarBirthday, today = new Date()): Date | null {
  const todayCal = bjCalToday(today);
  const candidates: Date[] = [];
  for (const year of [todayCal.getFullYear(), todayCal.getFullYear() + 1]) {
    const d = b.leap ? (lunarToSolarInYear(b, year, true) ?? lunarToSolarInYear(b, year, false)) : lunarToSolarInYear(b, year, false);
    if (d) candidates.push(d);
  }
  const t0 = dayStart(todayCal);
  return candidates.filter((d) => dayStart(d) >= t0).sort((a, z) => a.getTime() - z.getTime())[0] ?? null;
}

/** 农历生日 → 距下一次天数（0=今天）；无法换算返回 null */
export function lunarBirthdayCountdown(b: LunarBirthday, today = new Date()): number | null {
  const target = nextLunarBirthdaySolar(b, today);
  return target ? Math.round((dayStart(target) - dayStart(today)) / 86_400_000) : null;
}
