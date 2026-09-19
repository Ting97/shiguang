/**
 * 农历生日支持 —— 公历↔农历换算封装（solarlunar 3.x，覆盖 1900~2100）
 * 民间习俗：闰月生日在无闰月的年份按平月过；三十生日在小月按廿九过
 */

import solarLunar from "solarlunar";

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

/** 农历月日 → 某年公历日期；该年无此闰月/该月是小月没有这天 → 回落平月/廿九；仍失败返回 null */
function lunarToSolarInYear(b: LunarBirthday, year: number, leap: boolean): Date | null {
  const r = solarLunar.lunar2solar(year, b.month, b.day, leap);
  if (r !== -1) return new Date(r.cYear, r.cMonth - 1, r.cDay);
  const r29 = solarLunar.lunar2solar(year, b.month, Math.min(b.day, 29), leap);
  return r29 === -1 ? null : new Date(r29.cYear, r29.cMonth - 1, r29.cDay);
}

/** 农历生日 → 下一次过生日对应的公历日期（含今天） */
export function nextLunarBirthdaySolar(b: LunarBirthday, today = new Date()): Date | null {
  const candidates: Date[] = [];
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const d = b.leap ? (lunarToSolarInYear(b, year, true) ?? lunarToSolarInYear(b, year, false)) : lunarToSolarInYear(b, year, false);
    if (d) candidates.push(d);
  }
  const t0 = dayStart(today);
  return candidates.filter((d) => dayStart(d) >= t0).sort((a, z) => a.getTime() - z.getTime())[0] ?? null;
}

/** 农历生日 → 距下一次天数（0=今天）；无法换算返回 null */
export function lunarBirthdayCountdown(b: LunarBirthday, today = new Date()): number | null {
  const target = nextLunarBirthdaySolar(b, today);
  return target ? Math.round((dayStart(target) - dayStart(today)) / 86_400_000) : null;
}
