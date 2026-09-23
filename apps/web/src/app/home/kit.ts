/** 首页共用小工具 */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → 北京时间 HH:MM（UTC getter + 8h；getHours() 本地 getter 在非中国时区设备会错 8 小时） */
export const zhTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
