/**
 * moment-feed 小工具集：时间格式化 / 金额展示 / 表单值互转 / 常量。
 * 纯函数无副作用，被入口与卡片各子组件共用。
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** 北京日历日序号（UTC+8 推算，禁本地 getter：海外设备的日界会错 8 小时，与 moment-card 的 bjYmd 同口径） */
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

export const zhClock = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 记录时刻 →「今天 15:32 / 昨天 21:04 / 9月15日 08:30」 */
export const zhRecordTime = (iso: string) => {
  const t = Date.parse(iso);
  const nowT = Date.now();
  const diffDays = bjDayIdx(nowT) - bjDayIdx(t);
  const d = new Date(t + 8 * 3600_000);
  const clock = zhClock(iso);
  if (diffDays === 0) return { day: "今天", clock };
  if (diffDays === 1) return { day: "昨天", clock };
  const sameYear = d.getUTCFullYear() === new Date(nowT + 8 * 3600_000).getUTCFullYear();
  return {
    day: `${sameYear ? "" : d.getUTCFullYear() + "年"}${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
    clock,
  };
};

export const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** 待办时间标签：有起始时间且与到期同日 →「9:10–9:30」区间；否则退回单时刻 */
export function todoTimeLabel(startAt: string | null | undefined, dueAt: string | null): string | null {
  if (!dueAt) return null;
  if (startAt) {
    const a = Date.parse(startAt);
    const b = Date.parse(dueAt);
    const sameDay = bjDayIdx(a) === bjDayIdx(b);
    if (sameDay && b !== a) return `${zhClock(startAt)}–${zhClock(dueAt)}`;
  }
  const t = zhRecordTime(dueAt);
  return `${t.day} ${t.clock}`;
}

/** 跨天时间块的日期前缀：非今天 →「9月17日 」（避免凌晨记录的"昨天下午"被误读为今天） */
export const dayPrefix = (iso: string) => {
  const t = Date.parse(iso);
  const d = new Date(t + 8 * 3600_000);
  return bjDayIdx(Date.now()) - bjDayIdx(t) === 0
    ? ""
    : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 `;
};

export const COMMON_MOODS = ["开心", "满足", "兴奋", "放松", "平静", "疲惫", "焦虑", "烦躁", "难过", "生气"];

// 五域/关系域中文名（待确认提示等处使用）
export const DOMAIN_LABELS: Record<string, string> = {
  schedule: "日程",
  todo: "todo",
  finance: "收支",
  mood: "心情",
  diet: "饮食",
  people: "关系",
};

export const FEED_PAGE_SIZE_HINT = 10; // 超过一页才显示「到底啦」提示

/** 用原块日期 + 新的 HH:MM 组装 ISO（保持本地时区与原日期） */
export function combineHM(originalIso: string, hm: string): string {
  const d = new Date(originalIso);
  const [h, m] = hm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export const isoToLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const localInputToIso = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
