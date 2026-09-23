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
