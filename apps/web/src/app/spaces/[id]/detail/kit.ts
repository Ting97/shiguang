/** 空间详情页小工具（自 detail.tsx 拆出） */

/** pg date 字段经 node-pg 序列化为 UTC ISO（北京时间零点 → 前一日 16:00Z），按北京日期还原 */
export const bjDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
/** 北京今天（YYYY-MM-DD），用于判断目标是否已过期 */
export const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
