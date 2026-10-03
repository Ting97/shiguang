/**
 * feed 页共用小工具（= web moment-feed/kit.ts + lib/mood + lib/bj-time + lib/reminders 的页面局部门面）。
 * REQ-009 9-C 单源化：与 shared 同语义的纯函数（北京时区口径/时长格式化/心情 emoji/
 * 提醒横幅/交易类别/墙上时间换算）全部改从 @shiguangri/shared import 并在此 re-export，
 * 页面文件仍从 "./kit" 引入、不散改；仅保留 feed 卡片展示特有的拼装函数。
 */
import { bjDayIdx, zhTime } from "@shiguangri/shared";

/* ---------- shared 单源（re-export；bjClock=shared zhTime 的页面旧名） ---------- */

export {
  bjToday,
  bjDateKey,
  bjInputToIso,
  isoToBjInput,
  combineHM,
  zhDuration,
  zhTime as bjClock,
  TX_CATEGORIES,
  moodEmoji,
  pickReminders,
} from "@shiguangri/shared";
export type { ReminderItem, ReminderContact, ReminderTodo } from "@shiguangri/shared";

/** 北京日历日序号（下面按天分组的差值基元；UTC+8 推算，禁本地 getter） */
export { bjDayIdx };

/* ---------- 记录时刻展示（= web moment-feed/kit.ts） ---------- */

/** 记录时刻 →「今天 15:32 / 昨天 21:04 / 9月15日 08:30」（按天分组的键也来自它） */
export function zhRecordTime(iso: string): { day: string; clock: string } {
  const t = Date.parse(iso);
  const nowT = Date.now();
  const diffDays = bjDayIdx(nowT) - bjDayIdx(t);
  const d = new Date(t + 8 * 3600_000);
  const clock = zhTime(iso);
  if (diffDays === 0) return { day: "今天", clock };
  if (diffDays === 1) return { day: "昨天", clock };
  const sameYear = d.getUTCFullYear() === new Date(nowT + 8 * 3600_000).getUTCFullYear();
  return {
    day: `${sameYear ? "" : d.getUTCFullYear() + "年"}${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
    clock,
  };
}

/** 跨天时间块的日期前缀：非今天 →「9月17日 」（凌晨记录的「昨天下午」不被误读为今天） */
export function dayPrefix(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 8 * 3600_000);
  return bjDayIdx(Date.now()) - bjDayIdx(t) === 0 ? "" : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 `;
}

/** 待办时间标签：起止同日 →「9:10–9:30」区间；否则退回「9月17日 08:30」（= web todoTimeLabel） */
export function todoTimeLabel(startAt?: string | null, dueAt?: string | null): string | null {
  if (!dueAt) return null;
  if (startAt) {
    const a = Date.parse(startAt);
    const b = Date.parse(dueAt);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b && bjDayIdx(a) === bjDayIdx(b)) {
      return `${zhTime(startAt)}–${zhTime(dueAt)}`;
    }
  }
  return `${dayPrefix(dueAt)}${zhTime(dueAt)}`;
}

/** 金额分 → chip 展示串（= web moment-feed/kit yuan：¥ 前缀；整百不带小数，其余两位） */
export function yuanCents(cents: number | string): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  return `¥${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`;
}

/* ---------- 心情展示与页面常量（feed 局部；emoji 单源 shared/mood） ---------- */

/** 情绪分 → 文字色（积极琥珀 / 消极玫瑰 / 0 石墨 / 无分 mute）——返回主题令牌，深浅主题自动适配 */
export function moodToneColor(score: number | null | undefined): string {
  if (score == null) return "var(--ink-mute)";
  if (score > 0) return "var(--warn)";
  if (score < 0) return "var(--danger)";
  return "var(--ink-soft)";
}

export const COMMON_MOODS = ["开心", "满足", "兴奋", "放松", "平静", "疲惫", "焦虑", "烦躁", "难过", "生气"];

/** 五域/关系域中文名（待确认提示用，= web DOMAIN_LABELS） */
export const DOMAIN_LABELS: Record<string, string> = {
  schedule: "日程",
  todo: "todo",
  finance: "收支",
  mood: "心情",
  diet: "饮食",
  people: "关系",
};

/** 手动补日程的餐次/关系类型选项（= web entry-menu.tsx 内联常量） */
export const MEALS = ["早餐", "午餐", "晚餐", "加餐", "夜宵"];
export const PEOPLE_TYPES = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"];

/** 行动到期标签：已过期红 / 今天 / 明天 / N 天后 / 无时间（= web todo-bits.dueTag 的色彩版） */
export function dueTag(iso: string | null | undefined): { text: string; color: string } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t < Date.now()) return { text: "已过期", color: "var(--danger)" };
  const days = bjDayIdx(t) - bjDayIdx(Date.now());
  if (days === 0) return { text: "今天", color: "var(--warn)" };
  if (days === 1) return { text: "明天", color: "var(--accent)" };
  return { text: `${days} 天后`, color: "var(--ink-mute)" };
}
