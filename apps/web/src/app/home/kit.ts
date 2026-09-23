/** 首页共用小工具 */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → 本地 HH:MM */
export const zhTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
