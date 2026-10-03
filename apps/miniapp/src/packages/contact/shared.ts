/**
 * 人际分包 list/detail 两页共用的常量与小工具。
 * REQ-009 9-C 单源化：与 @shiguangri/shared/social 同语义的常量/纯函数改为从 shared 引入并
 * re-export（原「逐字对齐的手工拷贝」全数下线）；页面仍从 "../shared" 引入、不散改。
 * 仅保留本包刻意简化的部分：农历标签不做 solarlunar 换算（避免历法表进小程序包）、
 * TYPE_EMOJI 用宽 Record<string,string>（调用方以任意 string 索引）、useArmConfirm 等页面工具。
 */
import { useRef, useState } from "react";

export {
  CONTACT_GROUPS,
  IMPORTANCE_TIERS,
  importanceLabel,
  GROUP_EMOJI,
  GROUP_COLOR,
  INTERACTION_TYPES,
  displaySummary,
  birthdayCountdown,
} from "@shiguangri/shared";
export type { ContactGroup, InteractionType } from "@shiguangri/shared";
// 本文件内 birthdayInfoOf 还要直接调用（re-export 的绑定不在本模块作用域）
import { birthdayCountdown, bjDayIdx } from "@shiguangri/shared";

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

export const TYPE_EMOJI: Record<string, string> = {
  见面: "🤝",
  通话: "📞",
  送礼: "🎁",
  收礼: "🎀",
  请客: "🍽",
  帮忙: "🛠",
  其他: "•",
};

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
