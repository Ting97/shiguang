/**
 * 人际分包 list/detail 两页共用的常量与小工具。
 * 口径逐条对齐 packages/shared/src/social.ts + web lib/group-tone.ts + lib/bj-time
 * （小程序端不直接引 shared 包——monorepo 构建链路差异，字面量与其逐字对齐，改动需同步）。
 */
import { useRef, useState } from "react";

/** GET /api/contacts 行结构（= web contacts/page.tsx 本地 Contact 接口） */
export interface ContactRow {
  id: string;
  name: string;
  alias?: string | null;
  group_tag?: string;
  birthday?: string | null;
  birthday_cal?: string | null;
  lunar_month?: number | null;
  lunar_day?: number | null;
  lunar_leap?: boolean | null;
  anniversary?: string | null;
  intimacy?: number;
  importance?: number;
  notes?: string | null;
  created_at?: string;
  ai_profile?: { summary: string; likes: string[]; dislikes: string[]; facts: string[] } | null;
  ai_profile_at?: string | null;
  interaction_count?: number | string;
  last_at?: string | null;
  last_summary?: string | null;
  gift_net_cents?: number | string | null;
}

export const CONTACT_GROUPS = ["家人", "朋友", "同事", "同学", "客户", "其他"] as const;
export type ContactGroup = (typeof CONTACT_GROUPS)[number];

/** 重要程度五档（level 越大越重要，图谱中离中心越近） */
export const IMPORTANCE_TIERS = [
  { level: 5, label: "亲密" },
  { level: 4, label: "重要" },
  { level: 3, label: "普通" },
  { level: 2, label: "一般" },
  { level: 1, label: "简单" },
] as const;

export const importanceLabel = (level: number): string =>
  IMPORTANCE_TIERS.find((t) => t.level === level)?.label ?? "普通";

export const GROUP_EMOJI: Record<string, string> = {
  家人: "❤️",
  朋友: "🤝",
  同事: "💼",
  同学: "🎓",
  客户: "📇",
  其他: "👤",
};

/** 分组 → 语义 tone（= web GROUP_TONE；页面 scss 的 .tone-* 与之对应） */
export type Tone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";
export const GROUP_TONE: Record<string, Tone> = {
  家人: "rose",
  朋友: "amber",
  同事: "sky",
  同学: "emerald",
  客户: "violet",
  其他: "slate",
};

/** tone → 页面 scss 类名（.tone-* 在各页 scss 定义：语义 tinted 底 + 同色字） */
export const toneClass = (tone: Tone) => `tone-${tone}`;

/** 分组色（人际图谱节点/连线；= shared GROUP_COLOR 高饱和暗底色） */
export const GROUP_COLOR: Record<string, string> = {
  家人: "#f43f5e",
  朋友: "#f59e0b",
  同事: "#0ea5e9",
  同学: "#10b981",
  客户: "#8b5cf6",
  其他: "#64748b",
};

export const INTERACTION_TYPES = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const TYPE_EMOJI: Record<string, string> = {
  见面: "🤝",
  通话: "📞",
  送礼: "🎁",
  收礼: "🎀",
  请客: "🍽",
  帮忙: "🛠",
  其他: "•",
};

/** 往来摘要展示：折叠入库的「吃饭：吃饭」型重复拼接（= web displaySummary） */
export function displaySummary(summary: string | null | undefined): string {
  const s = (summary ?? "").trim();
  const i = s.indexOf("：");
  if (i > 0 && s.slice(i + 1) === s.slice(0, i)) return s.slice(0, i);
  return s;
}

/** 北京日历日序号（UTC+8 推算，禁本地 getter） */
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

/** 相对时间：刚刚/N分钟前/N小时前/昨天/M月D日（= web contacts/page.tsx relTime） */
export function relTime(iso: string): string {
  const t = Date.parse(iso);
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const days = bjDayIdx(Date.now()) - bjDayIdx(t);
  if (days === 1) return "昨天";
  const d = new Date(t + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** 时间线日标签：今天/昨天/M月D日（= web detail zhDay） */
export function zhDay(iso: string): string {
  const t = Date.parse(iso);
  const diff = bjDayIdx(Date.now()) - bjDayIdx(t);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(t + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** ISO → 北京 MM-DD HH:mm（「提炼于」展示用） */
export function bjMDHM(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * 阳历生日倒计时天数：0=今天；无效返回 null（= web birthdayCountdown，含 2/29 用「3 月 0 日」惯用法；
 * 今天按北京日历日取，非 CST 设备不错报一天）。
 */
export function birthdayCountdown(birthday: string | null | undefined): number | null {
  if (!birthday) return null;
  const m = String(birthday).match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dateOf = (y: number): number =>
    month === 2 && day === 29
      ? Date.UTC(y, 2, 0) // 3 月 0 日 = 2 月最后一天（平年 2/28、闰年 2/29）
      : Date.UTC(y, month - 1, day);
  const shifted = new Date(Date.now() + 8 * 3600_000);
  const todayIdx = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const thisYear = dateOf(shifted.getUTCFullYear());
  const target = thisYear >= todayIdx ? thisYear : dateOf(shifted.getUTCFullYear() + 1);
  return Math.round((target - todayIdx) / 86_400_000);
}

export interface BirthdayInfo {
  date: string;
  countdown: number | null;
  lunar: boolean;
  nextSolar: string | null;
}

/**
 * 生日完整信息（= web birthdayInfoOf）。
 * 简化：农历生日不做农历→公历换算（shared lunar2solar 依赖历法表，小程序端不引入），
 * 只回「农历X月Y日」标签、无倒计时/nextSolar；阳历与 web 完全同口径。
 */
export function birthdayInfoOf(c: ContactRow): BirthdayInfo | null {
  if (c.birthday_cal === "lunar" && c.lunar_month && c.lunar_day) {
    return { date: `农历${lunarMonthLabel(c.lunar_month)}${lunarDayLabel(c.lunar_day)}`, countdown: null, lunar: true, nextSolar: null };
  }
  const m = String(c.birthday ?? "").match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  return {
    date: `${Number(m[2])}月${Number(m[3])}日`,
    countdown: birthdayCountdown(c.birthday),
    lunar: false,
    nextSolar: null,
  };
}

/** 生日列表展示（= web birthdayLabel）：null | {date, countdown 短语} */
export function birthdayLabel(c: ContactRow): { date: string; countdown: string | null } | null {
  const info = birthdayInfoOf(c);
  if (!info) return null;
  let countdown: string | null = null;
  if (info.countdown === 0) countdown = "🎂 今天生日";
  else if (info.countdown === 1) countdown = "明天生日";
  else if (info.countdown != null) countdown = `${info.countdown} 天后生日`;
  return { date: info.date, countdown };
}

/* ---- 农历月/日中文标签（= shared lunarMonthLabel/lunarDayLabel，solar-lunar 算法同表） ---- */
const LUNAR_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
export const lunarMonthLabel = (m: number): string => `${LUNAR_MONTHS[m - 1] ?? m}月`;
export function lunarDayLabel(d: number): string {
  const tens = ["", "初", "十", "廿", "三"];
  const ones = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (d === 10) return "初十";
  if (d === 20) return "二十";
  if (d === 30) return "三十";
  return `${tens[Math.floor((d - 1) / 10)] ?? ""}${ones[(d - 1) % 10] ?? ""}`;
}

/**
 * 两步确认（= web useArmConfirm）：首点武装 3 秒，3 秒内再点才执行，超时自动解除。
 */
export function useArmConfirm() {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (id: string): boolean => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (armedId === id) {
      setArmedId(null);
      return true;
    }
    setArmedId(id);
    timerRef.current = setTimeout(() => setArmedId(null), 3000);
    return false;
  };
  return { armedId, arm };
}
