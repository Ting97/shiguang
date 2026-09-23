/** 北京时间（UTC+8）展示/存储小工具：首页与日程页统一口径（实现同 app/home/kit.ts 的 zhTime） */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → 北京时间 HH:MM（UTC getter + 8h；getHours() 本地 getter 在非中国时区设备会错 8 小时） */
export const zhTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 用原块北京日期 + 新的 HH:MM 组装 ISO（北京时间口径：+8h 推算 setUTC 后再回移 8h） */
export function combineHM(originalIso: string, hm: string): string {
  const d = new Date(new Date(originalIso).getTime() + 8 * 3600_000);
  const [h, m] = hm.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** ISO → datetime-local 输入值（北京墙上时间）：+8h 后取 UTC getter（本地 getter 在海外设备与全站展示口径错位） */
export const isoToBjInput = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** datetime-local 输入值（北京墙上时间）→ ISO：显式 +08:00 解析——裸串按宿主时区解释，服务端 UTC 容器上会偏 8 小时 */
export const bjInputToIso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = Date.parse(v.length === 16 ? `${v}:00+08:00` : `${v}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** ISO → 北京日历日键 YYYY-MM-DD（周/月/年视图归列用；localDateKey 是宿主时区口径，跨设备日界错位） */
export const bjDateKey = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
