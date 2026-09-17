/**
 * 时间块推断引擎（确定性规则）—— docs/06 §3.2
 * 输入一句话与当前时刻，推断 [start, end]：
 *  - 显式时长（"40分钟"）→ explicit
 *  - 相对时段（"下午/晚上/中午…"）→ relative（锚点 + 时长）
 *  - 无时长 → default（类别默认时长，结束于当下）
 */
import { parseDuration } from "./duration.js";

export type PeriodHint =
  | "now" | "morning" | "noon" | "afternoon" | "evening" | "night" | "lateNight";

export interface TimeBlockInferred {
  mode: "explicit" | "relative" | "default";
  start: Date;
  end: Date;
  durationMin: number;
}

/** 时段 → 当天锚点小时（24h 制，可为小数） */
const PERIOD_ANCHORS: Record<Exclude<PeriodHint, "now">, number> = {
  morning: 8,      // 早上/上午
  noon: 12,        // 中午
  afternoon: 14,   // 下午
  evening: 19,     // 晚上
  night: 22,       // 深夜/夜里
  lateNight: 1,    // 凌晨
};

const PERIOD_WORDS: Array<[RegExp, PeriodHint]> = [
  [/凌晨|清晨/, "lateNight"],
  [/早上|早晨|上午/, "morning"],
  [/中午|午饭|午休/, "noon"],
  [/下午|午后/, "afternoon"],
  [/傍晚|晚上|今晚|夜里|深夜/, "evening"],
];

/** 从文本识别相对时段词；无则返回 null */
export function detectPeriod(text: string): PeriodHint | null {
  for (const [re, hint] of PERIOD_WORDS) if (re.test(text)) return hint;
  return null;
}

function atHour(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
}

/**
 * 推断时间块。
 * @param text       原始话术
 * @param now        当前时刻（服务器/客户端时钟）
 * @param defaultMin 类别默认时长（分钟）
 * @param periodHint LLM 给出的时段提示（可选；缺省从 text 再识别一次）
 */
export function inferTimeBlock(
  text: string,
  now: Date,
  defaultMin: number,
  periodHint?: PeriodHint | null,
): TimeBlockInferred {
  const duration = parseDuration(text);
  const period = periodHint ?? detectPeriod(text);
  const dur = duration ?? defaultMin;

  const clampToNow = (start: Date, end: Date): [Date, Date] =>
    end > now ? [new Date(now.getTime() - dur * 60_000), new Date(now)] : [start, end];

  // 1) 有相对时段 → 锚点起 + 时长
  if (period && period !== "now") {
    let anchor = atHour(now, PERIOD_ANCHORS[period]);
    if (anchor > now) anchor = new Date(anchor.getTime() - 24 * 3600_000); // 未来锚点视为昨天
    let end = new Date(anchor.getTime() + dur * 60_000);
    [anchor, end] = clampToNow(anchor, end);
    return { mode: duration ? "explicit" : "relative", start: anchor, end, durationMin: dur };
  }

  // 2) 无时段（含"刚…"）→ 结束于当下，回溯时长
  const end = new Date(now);
  const start = new Date(now.getTime() - dur * 60_000);
  return { mode: duration ? "explicit" : "default", start, end, durationMin: dur };
}
