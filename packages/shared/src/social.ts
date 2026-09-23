/**
 * 人际模块纯函数工具（Phase 3 W9）——联系人分组推断 / 往来类型推断 / 生日倒计时
 * 被 /api/parse（语音自动建档）与 /contacts 页面共用
 */
import { lunarBirthdayCountdown, lunarBirthdayLabel, nextLunarBirthdaySolar } from "./lunar";

export const CONTACT_GROUPS = ["家人", "朋友", "同事", "同学", "客户", "其他"] as const;
export type ContactGroup = (typeof CONTACT_GROUPS)[number];

/** 重要程度五档：level 越大越重要（图谱中离中心越近） */
export const IMPORTANCE_TIERS = [
  { level: 5, label: "亲密" },
  { level: 4, label: "重要" },
  { level: 3, label: "普通" },
  { level: 2, label: "一般" },
  { level: 1, label: "简单" },
] as const;
export type ImportanceTier = (typeof IMPORTANCE_TIERS)[number]["level"];

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

export const INTERACTION_TYPES = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const TYPE_EMOJI: Record<InteractionType, string> = {
  见面: "🤝",
  通话: "📞",
  送礼: "🎁",
  收礼: "🎀",
  请客: "🍽",
  帮忙: "🛠",
  其他: "•",
};

/** 语音提及自动建档时的分组推断：命中返回组名，未命中返回 null（调用方落「朋友」默认） */
export function inferGroupFromName(name: string): ContactGroup | null {
  if (!name) return null;
  if (/(同事|领导|老板|上司|下属|甲乙方)/.test(name)) return "同事";
  if (/(客户|甲方|乙方)/.test(name)) return "客户";
  if (/(同学|室友|校友)/.test(name)) return "同学";
  if (
    /(爸爸|妈妈|爸妈|老爸|老妈|父亲|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|儿子|女儿|老婆|老公|媳妇|女婿|岳父|岳母)/.test(name) ||
    /(伯|叔|姑|舅|姨|嫂|婶)/.test(name)
  ) {
    return "家人";
  }
  return null;
}

/**
 * 上下文版分组推断：LLM 常把「客户张总」抽成「张总」，身份前缀被剥掉，
 * 只拿名字推断永远落「朋友」。回原句找到名字位置，把它前面的修饰词拼回来再推断。
 * 名字本身能命中的（老妈/王老板）直接返回；原句里找不到名字返回 null。
 */
export function inferGroupFromContext(name: string, rawText: string): ContactGroup | null {
  if (!name || !rawText) return null;
  const direct = inferGroupFromName(name);
  if (direct) return direct;
  const i = rawText.indexOf(name);
  if (i < 0) return null;
  return inferGroupFromName(rawText.slice(Math.max(0, i - 4), i) + name);
}

/** 分组色（人际图谱 / 列表头像共用）：与全局色板同风格的高饱和暗底色 */
export const GROUP_COLOR: Record<string, string> = {
  家人: "#f43f5e",
  朋友: "#f59e0b",
  同事: "#0ea5e9",
  同学: "#10b981",
  客户: "#8b5cf6",
  其他: "#64748b",
};

/** 往来事件短语 → 互动类型（原 event 来自 LLM 抽取，如 吃饭/送礼/打电话） */
export function inferInteractionType(event?: string | null): InteractionType {
  const e = (event ?? "").trim();
  if (!e) return "其他";
  if (/(收到|收礼|收了).{0,4}(礼|红包|礼物)|收红包/.test(e)) return "收礼";
  if (/(送礼|送了|随礼|份子|礼物|包了红包)/.test(e)) return "送礼";
  if (/(电话|通话|语音|视频)/.test(e)) return "通话";
  if (/(帮忙|帮了|帮我|协助|搭把手)/.test(e)) return "帮忙";
  if (/(请客|请了|请我们|做东)/.test(e)) return "请客";
  if (/(吃饭|聚餐|喝咖啡|咖啡|奶茶|小酌|宵夜|午饭|晚饭|早饭|碰面|见面|开会|碰头|逛街|散步|聊)/.test(e)) return "见面";
  return "其他";
}

/** 往来摘要展示：兼容去重修复前入库的「吃饭：吃饭」型重复拼接，显示时折叠为「吃饭」 */
export function displaySummary(summary: string | null | undefined): string {
  const s = (summary ?? "").trim();
  const i = s.indexOf("：");
  if (i > 0 && s.slice(i + 1) === s.slice(0, i)) return s.slice(0, i);
  return s;
}

/** 生日字段视图：阳历存 birthday；农历存 lunar_*（birthday_cal='lunar' 时 birthday 为空） */
export interface BirthdayFields {
  birthday?: string | null; // 阳历 YYYY-MM-DD
  birthday_cal?: string | null; // 'solar' | 'lunar'
  lunar_month?: number | null;
  lunar_day?: number | null;
  lunar_leap?: boolean | null;
}

/** 距下一个生日天数（自动区分阳历/农历）：0=今天；无效返回 null */
export function birthdayCountdownOf(c: BirthdayFields, today = new Date()): number | null {
  if (c.birthday_cal === "lunar" && c.lunar_month && c.lunar_day) {
    return lunarBirthdayCountdown({ month: c.lunar_month, day: c.lunar_day, leap: !!c.lunar_leap }, today);
  }
  return birthdayCountdown(c.birthday, today);
}

/** 生日完整信息：date 展示文本（农历带「农历」前缀）、下一次生日对应公历（仅农历有） */
export function birthdayInfoOf(
  c: BirthdayFields,
  today = new Date(),
): { date: string; countdown: number | null; lunar: boolean; nextSolar: string | null } | null {
  if (c.birthday_cal === "lunar" && c.lunar_month && c.lunar_day) {
    const b = { month: c.lunar_month, day: c.lunar_day, leap: !!c.lunar_leap };
    const next = nextLunarBirthdaySolar(b, today);
    // 下一次生日可能落在明年（闰月回落/今年已过）：前缀区分「今年/明年」
    const nextSolar = next
      ? `${next.getFullYear() === today.getFullYear() ? "今年" : "明年"}${next.getMonth() + 1}月${next.getDate()}日`
      : null;
    return {
      date: `农历${lunarBirthdayLabel(b)}`,
      countdown: lunarBirthdayCountdown(b, today),
      lunar: true,
      nextSolar,
    };
  }
  const m = String(c.birthday ?? "").match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  return {
    date: `${Number(m[2])}月${Number(m[3])}日`,
    countdown: birthdayCountdown(c.birthday, today),
    lunar: false,
    nextSolar: null,
  };
}

/** 距下一个生意的天数：0=今天；生日为 "MM-DD" 或完整日期字符串；无效返回 null */
export function birthdayCountdown(birthday: string | null | undefined, today = new Date()): number | null {
  if (!birthday) return null;
  const m = String(birthday).match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 2/29 生日：new Date(y,1,29) 在平年会滚到 3/1 → 用「3 月 0 日」惯用法显式取 2 月最后一天（平年 2/28、闰年 2/29）
  const dateOf = (y: number): Date => (month === 2 && day === 29 ? new Date(y, 2, 0) : new Date(y, month - 1, day));
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const thisYear = dateOf(today.getFullYear());
  const target = thisYear.getTime() >= dayStart(today) ? thisYear : dateOf(today.getFullYear() + 1);
  return Math.round((target.getTime() - dayStart(today)) / 86_400_000);
}

/** 生日展示（自动区分阳历/农历）：null → null；返回 "10月2日"/"农历五月初二" 与倒计时短语 */
export function birthdayLabel(c: BirthdayFields, today = new Date()): { date: string; countdown: string | null } | null {
  const info = birthdayInfoOf(c, today);
  if (!info) return null;
  let countdown: string | null = null;
  if (info.countdown === 0) countdown = "🎂 今天生日";
  else if (info.countdown === 1) countdown = "明天生日";
  else if (info.countdown != null) countdown = `${info.countdown} 天后生日`;
  return { date: info.date, countdown };
}
