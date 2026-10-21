import { bjDayIdx, isoToBjInput, bjInputToIso, zhTime } from "@/lib/bj-time";
import { yuan as sharedYuan } from "@shiguangri/shared/finance";

/**
 * moment-feed 小工具集：时间格式化 / 金额展示 / 表单值互转 / 常量。
 * 纯函数无副作用，被入口与卡片各子组件共用。
 */

/** 北京墙上时钟（实现单源 @shiguangri/shared，UTC+8 推算禁本地 getter） */
export const zhClock = zhTime;

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

/** 金额展示（¥ 前缀 + shared 整数取商余版 yuan，禁浮点除法） */
export const yuan = (cents: number) => `¥${sharedYuan(cents)}`;

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

export const isoToLocalInput = (iso: string | null) => (iso ? isoToBjInput(iso) : "");

export const localInputToIso = (v: string) => bjInputToIso(v);
