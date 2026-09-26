/**
 * 人际分包 list/detail 两页共用的常量与小工具。
 * 口径对齐 packages/shared/src/social.ts（小程序端不直接引 shared 包——monorepo tsconfig
 * 是否含该包路径由构建侧决定，这里的字面量与其逐字对齐，改动需同步）。
 */

/** 分组 → emoji（social.ts GROUP_EMOJI 同源） */
export const GROUP_EMOJI: Record<string, string> = {
  家人: "❤️",
  朋友: "🤝",
  同事: "💼",
  同学: "🎓",
  客户: "📇",
  其他: "👤",
};

/** 重要程度五档标签（social.ts IMPORTANCE_TIERS 同源；level 越大越重要） */
export const IMPORTANCE_LABEL: Record<number, string> = {
  5: "亲密",
  4: "重要",
  3: "普通",
  2: "一般",
  1: "简单",
};

/** 往来类型 → emoji（social.ts TYPE_EMOJI 同源） */
export const TYPE_EMOJI: Record<string, string> = {
  见面: "🤝",
  通话: "📞",
  送礼: "🎁",
  收礼: "🎀",
  请客: "🍽",
  帮忙: "🛠",
  其他: "•",
};

/**
 * 生日徽标：阳历生日返回倒计时（「今天生日🎂」/「生日还有 N 天」），农历生日显示「农历M/D」，
 * 没填生日返回空串。birthday 是 to_char 出的纯 YYYY-MM-DD 串，无时区漂移；
 * 倒计时用 Date.UTC 计算今年的月日，已过则算明年（避免 Date.parse 裸串被宿主时区解释）。
 */
export function birthdayBadge(c: {
  birthday?: string | null;
  birthday_cal?: string | null;
  lunar_month?: number | null;
  lunar_day?: number | null;
}): string {
  if (c.birthday_cal === "lunar" || (!c.birthday && c.lunar_month && c.lunar_day)) {
    return c.lunar_month && c.lunar_day ? `农历${c.lunar_month}/${c.lunar_day}` : "";
  }
  const b = c.birthday;
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return "";
  const mm = Number(b.slice(5, 7));
  const dd = Number(b.slice(8, 10));
  // 北京今天（+8h 归一，与全站口径一致；getFullYear 等本地 getter 在海外设备会错日）
  const now = new Date(Date.now() + 8 * 3600_000);
  const ty = now.getUTCFullYear();
  const diff = (target: number) =>
    Math.round((Date.UTC(target, mm - 1, dd) - Date.UTC(ty, now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  const d = diff(ty) >= 0 ? diff(ty) : diff(ty + 1);
  if (d === 0) return "今天生日🎂";
  if (d <= 30) return `生日还有 ${d} 天`;
  return "";
}
