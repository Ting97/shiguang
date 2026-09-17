/**
 * 人际模块纯函数工具（Phase 3 W9）——联系人分组推断 / 往来类型推断 / 生日倒计时
 * 被 /api/parse（语音自动建档）与 /contacts 页面共用
 */

export const CONTACT_GROUPS = ["家人", "朋友", "同事", "同学", "客户", "其他"] as const;
export type ContactGroup = (typeof CONTACT_GROUPS)[number];

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

/** 距下一个生意的天数：0=今天；生日为 "MM-DD" 或完整日期字符串；无效返回 null */
export function birthdayCountdown(birthday: string | null | undefined, today = new Date()): number | null {
  if (!birthday) return null;
  const m = String(birthday).match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const thisYear = new Date(today.getFullYear(), month - 1, day);
  const target = thisYear.getTime() >= dayStart(today) ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((target.getTime() - dayStart(today)) / 86_400_000);
}

/** 生日展示：null → null；返回 "10月2日" 与倒计时短语 */
export function birthdayLabel(birthday: string | null | undefined, today = new Date()): { date: string; countdown: string | null } | null {
  if (!birthday) return null;
  const c = birthdayCountdown(birthday, today);
  const m = String(birthday).match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = `${Number(m[2])}月${Number(m[3])}日`;
  if (c === null) return { date, countdown: null };
  if (c === 0) return { date, countdown: "🎂 今天生日" };
  if (c === 1) return { date, countdown: "明天生日" };
  return { date, countdown: `${c} 天后生日` };
}
