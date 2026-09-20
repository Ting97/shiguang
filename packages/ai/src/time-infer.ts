/**
 * 时间块推断引擎（确定性规则）—— docs/06 §3.2
 * 语义分流：
 *  - 未来话术（明天/后天/下周/待会儿/计划…）→ mode 'future' → 上层创建 TODO（带计划时间，不钳制）
 *  - 过去/当前话术（默认）→ explicit / relative / default → 生成已发生的日程时间块
 */
import { parseDuration, cnToNumber } from "./duration";

export type PeriodHint =
  | "now" | "morning" | "noon" | "afternoon" | "evening" | "night" | "lateNight";

export type FutureHint = "soon" | "tomorrow" | "dayAfter" | "nextWeek";

export interface TimeBlockInferred {
  mode: "explicit" | "relative" | "default" | "future";
  start: Date;
  end: Date;
  durationMin: number;
}

/** 时段 → 当天锚点小时 */
const PERIOD_ANCHORS: Record<Exclude<PeriodHint, "now">, number> = {
  morning: 8, noon: 12, afternoon: 14, evening: 19, night: 22, lateNight: 1,
};

/** 时段 → 常识时间窗 [起, 止)（止可 >24 表示跨午夜）；用于判断"现在是否正处于该时段" */
const PERIOD_SPAN: Record<Exclude<PeriodHint, "now">, [number, number]> = {
  morning: [5, 12], noon: [11, 15], afternoon: [12, 18],
  evening: [17, 24], night: [21, 26], lateNight: [0, 6],
};

/** 现在是否处于该时段的常识窗口内（跨午夜窗口折返判断） */
function periodOngoing(period: Exclude<PeriodHint, "now">, now: Date): boolean {
  const [ws, we] = PERIOD_SPAN[period];
  const h = now.getHours();
  if (we <= 24) return h >= ws && h < we;
  return h >= ws || h < we - 24; // 跨午夜：night [21,26) → 21..23 或 0..1
}

const PERIOD_WORDS: Array<[RegExp, Exclude<PeriodHint, "now">]> = [
  [/凌晨|清晨/, "lateNight"],
  [/早上|早晨|上午/, "morning"],
  [/中午|午饭|午休/, "noon"],
  [/下午|午后/, "afternoon"],
  [/傍晚|晚上|今晚|夜里|深夜/, "evening"],
];

export function detectPeriod(text: string): Exclude<PeriodHint, "now"> | null {
  for (const [re, hint] of PERIOD_WORDS) if (re.test(text)) return hint;
  return null;
}

/** 未来话术检测：返回天数提示；非未来返回 null */
export function detectFuture(text: string): FutureHint | null {
  if (/后天/.test(text)) return "dayAfter";
  if (/明天|明早|明晚/.test(text)) return "tomorrow";
  if (/下周|下礼拜|下星期/.test(text)) return "nextWeek";
  if (/待会|等会|等一下|晚点|稍后/.test(text)) return "soon";
  // "一会儿"仅在未来语境算（"过一会儿再去"）；"刚做了一会儿拉伸"是过去
  if (/(过|等|再)一会儿|一会儿(再|之后|就去|要)/.test(text)) return "soon";
  // 计划/准备只认动词性用法（"准备去开会"是未来，"工作准备/准备工作"是名词），
  // 裸词会误伤补记（如"今天9:10到9:30工作准备+喝水"被拐进未来分支），已交给 LLM 结合当前时间判定
  if (/(计划[着去要下]|打算|准备[去要下]|记得|要[去办交开]|得去)/.test(text)) return "soon";
  return null;
}

/**
 * 相对日引用检测（过去/当日）：昨天/前天/大前天/上周X/上礼拜X/周X。
 * 返回相对今天的天数偏移（≤0），null=没有显式相对日。周制：周一为一周开始。
 */
export function detectDayRef(text: string, now: Date): number | null {
  if (/大前天/.test(text)) return -3;
  if (/前天/.test(text)) return -2;
  if (/昨天|昨晚|昨夜|昨儿/.test(text)) return -1;
  const wd = text.match(/(上)?(?:周|礼拜|星期)([一二三四五六日天])/);
  if (wd) {
    const target = WEEKDAYS[wd[2]]; // 0=周日
    const posInWeek = target === 0 ? 6 : target - 1; // 周一=0 … 周日=6
    const daysIntoWeek = (now.getDay() + 6) % 7;
    if (wd[1]) return -(daysIntoWeek + 7 - posInWeek); // 上周X
    let offset = posInWeek - daysIntoWeek; // 本周内的 X 相对今天
    if (offset > 0) offset -= 7; // 本周还没到的周X，过去语境视为上周 X
    return offset;
  }
  if (/上周|上礼拜|上星期/.test(text)) return -7;
  if (/今天|今日/.test(text)) return 0;
  return null;
}

/** 话术中的钟点："三点"/"15:30"/"7点半"/"6.30"(配合 period 换算 12/24h) */
export function parseClock(text: string, period: PeriodHint | null): { hour: number; minute: number } | null {
  const m = text.match(
    /(\d{1,2}|[一二两三四五六七八九十]+)\s*(?:[点时](?!点)\s*(半|\d{1,2})?\s*分?|[.:：](\d{2}))/,
  );
  if (!m) return null;
  // 叠字守卫：中文数字叠字（"一一"）非数字；单字（一/三）与阿拉伯数字（11/22）合法
  if (m[1].length > 1 && !/^[0-9]+$/.test(m[1]) && [...m[1]].every((c) => c === m[1][0])) return null;
  const n = cnToNumber(m[1]);
  if (n === null || n > 23) return null;
  let hour = n;
  // "点半"→30；点后数字→分钟；点号两位（6.30）→30 分（须两位数，避免"5.5小时"误伤）
  const minute = m[2] ? (m[2] === "半" ? 30 : parseInt(m[2], 10)) : m[3] ? parseInt(m[3], 10) : 0;
  if (minute > 59) return null;
  // "下午三点"→15、"晚上八点"→20（小时制+下午/晚上偏移）
  if (hour < 12 && (period === "afternoon" || period === "evening" || period === "night")) hour += 12;
  return { hour, minute };
}

/**
 * 显式钟点区间："6.30-7.30"/"7点半到8点半"/"9:00~11:00" 等。
 * 以区间分隔符（到/至/-/~/—）切两半，各自解析一个钟点；解析不出两个钟点则返回 null。
 * 12/24h 偏移规则：起点在 pm 时段且 <12 → +12；终点 +12 后仍晚于起点才 +12
 * （"下午2.30到3.30"→14:30-15:30；"晚上10.30到6.30"→22:30-次日06:30，不把 6 点抬成 18 点）
 */
export function parseClockRange(
  text: string,
  period: PeriodHint | null,
): { start: { hour: number; minute: number }; end: { hour: number; minute: number } } | null {
  const parts = text.split(/\s*(?:到|至|~|—|–|-)\s*/);
  if (parts.length !== 2) return null;
  const pmish = period === "afternoon" || period === "evening" || period === "night";
  const a = parseClock(parts[0], pmish ? period : null);
  const b = parseClock(parts[1], null);
  if (!a || !b) return null;
  let endHour = b.hour;
  if (pmish && b.hour < 12 && b.hour + 12 > a.hour) endHour = b.hour + 12;
  return { start: a, end: { hour: endHour, minute: b.minute } };
}

const WEEKDAYS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

const MAX_SPAN_MS = 366 * 24 * 3600_000;

/** 校验 AI 直推的时刻（北京时间本地串）：非法/距当前超 366 天 → null */
export function resolveMoment(s: string | null | undefined, now: Date): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  if (Math.abs(d.getTime() - now.getTime()) > MAX_SPAN_MS) return null;
  return d;
}

/** 校验 AI 直推的起止区间：end<=start / 超幅 → null */
export function resolveExplicitRange(
  startStr: string | null | undefined,
  endStr: string | null | undefined,
  now: Date,
): { start: Date; end: Date } | null {
  const start = resolveMoment(startStr, now);
  if (!start) return null;
  const end = resolveMoment(endStr, now);
  if (!end || end <= start) return null;
  return { start, end };
}

function atHour(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60) + minute, 0, 0);
  return d;
}

// ---------- 日期锚定（用户规则：话术没写具体是哪一天 → 一律按当天） ----------

/** 话术是否显式提到某个日期（今天/昨天/明天/周X/上周/下周/2026-09-20/9月20日…） */
const EXPLICIT_DAY_RE =
  /(今天|今日|昨天|昨晚|昨夜|昨儿|前天|大前天|明天|明早|明晚|明儿|后天|大后天|上周|上礼拜|上星期|下周|下礼拜|下星期|周[一二三四五六日天末]|礼拜[一二三四五六日天末]|星期[一二三四五六日天末]|\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[日号])/;

export function hasExplicitDayRef(text: string): boolean {
  return EXPLICIT_DAY_RE.test(text);
}

/** 北京时间日序号（不依赖运行时区）：两时刻的日序号差 = 相隔整天数 */
function cstDayIdx(d: Date): number {
  return Math.floor((d.getTime() + 8 * 3600_000) / 86400_000);
}
function cstHour(d: Date): number {
  return new Date(d.getTime() + 8 * 3600_000).getUTCHours();
}

/**
 * AI 区间硬锚定到"今天"：话术无任何日期词且非未来话术时，模型偶发把当天区间
 * 挪到明天/昨天（如 17:22 说"下午2点到6点"被写成次日）——按整天平移保钟点。
 * 例外：凌晨（0-5 点）补记白天的区间归昨天，与提示词规则一致。
 */
export function anchorRangeToToday<T extends { start: Date; end: Date }>(range: T, text: string, now: Date): T {
  if (hasExplicitDayRef(text) || detectFuture(text) !== null) return range;
  const diff = cstDayIdx(now) - cstDayIdx(range.start);
  if (diff === 0 || (diff === 1 && cstHour(now) < 5)) return range;
  const shift = diff * 86400_000;
  return { ...range, start: new Date(range.start.getTime() + shift), end: new Date(range.end.getTime() + shift) };
}

/** AI 单时刻（todo.due）同款锚定 */
export function anchorMomentToToday(moment: Date, text: string, now: Date): Date {
  return anchorRangeToToday({ start: moment, end: moment }, text, now).start;
}

/** 计算未来计划时刻（不钳制） */
function inferFuture(
  text: string, now: Date, defaultMin: number, future: FutureHint,
): TimeBlockInferred {
  const dur = parseDuration(text) ?? defaultMin;
  const period = detectPeriod(text);
  const clock = parseClock(text, period);

  let start: Date;
  if (future === "soon") {
    // 待会儿/计划：有钟点且在今天未来 → 用之；否则 now + 1h
    if (clock) {
      start = atHour(now, clock.hour, clock.minute);
      if (start <= now) start = new Date(start.getTime() + 24 * 3600_000);
    } else {
      start = new Date(now.getTime() + 60 * 60_000);
    }
  } else {
    // 目标日：明天/后天直接加天数；下周先定位到下周一再加星期偏移
    if (future === "nextWeek") {
      const daysToMonday = ((8 - now.getDay()) % 7) || 7; // 下周一（getDay: 周日=0）
      start = new Date(now.getTime() + daysToMonday * 24 * 3600_000);
      const wd = text.match(/(?:下周|下礼拜|下星期)([一二三四五六日天])/);
      if (wd) {
        const target = WEEKDAYS[wd[1]]; // 0=周日
        const offset = target === 0 ? 6 : target - 1; // 周一为 0
        start = new Date(start.getTime() + offset * 24 * 3600_000);
      }
    } else {
      const days = future === "tomorrow" ? 1 : 2;
      start = new Date(now.getTime() + days * 24 * 3600_000);
    }
    const hour = clock ? clock.hour : period ? PERIOD_ANCHORS[period] : 9;
    start = atHour(start, hour, clock?.minute ?? 0);
  }
  return { mode: "future", start, end: new Date(start.getTime() + dur * 60_000), durationMin: dur };
}

/**
 * 推断时间块。
 * @param text          原始话术
 * @param now           当前时刻
 * @param defaultMin    类别默认时长（分钟）
 * @param periodHint    LLM 时段提示（可选）
 * @param forceFuture   LLM 判定为未来（TODO）；缺省由文本规则检测
 */
export function inferTimeBlock(
  text: string,
  now: Date,
  defaultMin: number,
  periodHint?: PeriodHint | null,
  forceFuture?: boolean,
): TimeBlockInferred {
  // 0) 未来 → TODO 计划时刻（不钳制）
  const future = forceFuture ? (detectFuture(text) ?? "soon") : detectFuture(text);
  if (future) return inferFuture(text, now, defaultMin, future);

  const duration = parseDuration(text);
  const period = periodHint ?? detectPeriod(text);
  const dur = duration ?? defaultMin;

  const clampToNow = (start: Date, end: Date): [Date, Date] =>
    end > now ? [new Date(now.getTime() - dur * 60_000), new Date(now)] : [start, end];

  // 0.5) 显式钟点区间（"6.30-7.30"/"7点半到8点半"，可叠加 昨天/前天 等相对日）
  //      用户明确给出起止钟点 → 精确落时段，不做 clampToNow 收拢（哪怕结尾略超记录时刻）
  const range = parseClockRange(text, period ?? (/昨晚|昨夜/.test(text) ? "evening" : null));
  const dayRef = detectDayRef(text, now);
  if (range) {
    // 无相对日且在凌晨（<5点）补记白天的区间 → 归昨天
    const back = dayRef !== null ? -dayRef * 24 * 3600_000 : now.getHours() < 5 ? 24 * 3600_000 : 0;
    const base = new Date(now.getTime() - back);
    let start = atHour(base, range.start.hour, range.start.minute);
    let end = atHour(base, range.end.hour, range.end.minute);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600_000); // 跨天区间（如 22.30-6.30）
    return {
      mode: "explicit",
      start,
      end,
      durationMin: Math.round((end.getTime() - start.getTime()) / 60_000),
    };
  }

  // 0.6) 显式相对日（昨天/前天/上周X/周X）：日期 = 今天偏移，时刻 = 钟点/时段锚点（无则按 20:00 回顾锚）
  if (dayRef !== null) {
    const base = new Date(now.getTime() + dayRef * 24 * 3600_000);
    const clock = parseClock(text, period);
    let anchor = clock
      ? atHour(base, clock.hour, clock.minute)
      : period && period !== "now"
        ? atHour(base, PERIOD_ANCHORS[period])
        : atHour(base, 20);
    let end = new Date(anchor.getTime() + dur * 60_000);
    [anchor, end] = clampToNow(anchor, end); // 今天且锚点在未来时收拢到当下
    return { mode: duration ? "explicit" : "relative", start: anchor, end, durationMin: dur };
  }

  // 1) 有相对时段 → 锚点起 + 时长
  if (period && period !== "now") {
    let anchor = atHour(now, PERIOD_ANCHORS[period]);
    if (anchor > now && !periodOngoing(period, now)) {
      // 过去语境且锚点在今天尚未到来、且当下不在该时段窗口内 → 归昨天
      // （15:00 说"晚上刷了抖音"=昨晚；而 07:17 说"早上醒来…"时段正在进行，保留今天）
      anchor = new Date(anchor.getTime() - 24 * 3600_000);
    }
    let end = new Date(anchor.getTime() + dur * 60_000);
    [anchor, end] = clampToNow(anchor, end);
    return { mode: duration ? "explicit" : "relative", start: anchor, end, durationMin: dur };
  }

  // 2) 无时段（含"刚…"）→ 结束于当下，回溯时长
  const end = new Date(now);
  const start = new Date(now.getTime() - dur * 60_000);
  return { mode: duration ? "explicit" : "default", start, end, durationMin: dur };
}
