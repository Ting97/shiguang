/**
 * 时间块推断引擎（确定性规则）—— docs/06 §3.2
 * 语义分流：
 *  - 未来话术（明天/后天/下周/待会儿/计划…）→ mode 'future' → 上层创建 TODO（带计划时间，不钳制）
 *  - 过去/当前话术（默认）→ explicit / relative / default → 生成已发生的日程时间块
 */
import { parseDuration, cnToNumber } from "./duration";

export type PeriodHint =
  | "now" | "morning" | "noon" | "afternoon" | "evening" | "night" | "lateNight";

export type FutureHint = "soon" | "tomorrow" | "dayAfter" | "twoDaysAfter" | "nextWeek";

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
  const h = cstHour(now); // 北京钟点，不依赖宿主机时区
  if (we <= 24) return h >= ws && h < we;
  return h >= ws || h < we - 24; // 跨午夜：night [21,26) → 21..23 或 0..1
}

const PERIOD_WORDS: Array<[RegExp, Exclude<PeriodHint, "now">]> = [
  [/凌晨|清晨/, "lateNight"],
  [/早上|早晨|上午/, "morning"],
  [/中午|午饭|午休/, "noon"],
  [/下午|午后/, "afternoon"],
  // 明晚（裸形态，区别于「明天晚上」）必须进 evening：旧版 detectPeriod=null，
  // 规则兜底把「明晚八点开会」按早晨 8 点锚（十二/十四轮实测）；昨晚/昨夜同理——
  // 单钟点路径「昨夜11点刷了手机」被落成上午 11 点
  [/傍晚|晚上|今晚|夜里|深夜|明晚|昨晚|昨夜/, "evening"],
];

export function detectPeriod(text: string): Exclude<PeriodHint, "now"> | null {
  for (const [re, hint] of PERIOD_WORDS) if (re.test(text)) return hint;
  return null;
}

/** 未来话术检测：返回天数提示；非未来返回 null */
export function detectFuture(text: string): FutureHint | null {
  if (/大后天/.test(text)) return "twoDaysAfter"; // 必须先于 /后天/ 判定，否则被吞成 +2
  if (/后天/.test(text)) return "dayAfter";
  // 「明儿」对齐「明天」既有处理（+1 天 + 钟点/时段锚）：旧版混入 soon 桶 → now+1h
  if (/明天|明早|明晚|明儿/.test(text)) return "tomorrow";
  if (/下周|下礼拜|下星期/.test(text)) return "nextWeek";
  // 月底/月初/下(个)月/相对偏移（"3天后交报告""两周后复盘""下月15号交房租"）等未来词
  // （旧版词表缺口：这些话术 detectFuture=null → AI 算对的未来 due 被 anchorMomentToToday
  //  按「无日期词 → 按当天」整平移到今天，待办当天到期/立即误报——十轮「下周三」同根收尾；
  //  十一轮补裸「下月」（下个?月份? 全形态，与 monthDayBase 的 dayNumM 同口径，缺「个」不漏）。
  //  月初/月底用负向后顾排除过去前缀——「上个月初随了600份子」「本月初还了贷」是过去补记，
  //  裸子串匹配会把它们翻成未来待办、锚到下月 1 号（方向全反）。前缀集不同：
  //  月初排除 上/本/这/每（月首说话时必已过去）；月底仅排除 上/每（「这个月底交房租」
  //  在月末前说仍是未来，本月底=当前月末由 monthDayBase 月历锚承接））
  if (/(?<![上本这每]个?)月初|(?<![上每]个?)月(?:底|末)|下个?月份?/.test(text)) return "soon";
  // 「两小时后取快递」「半小时后开会」：旧版词表缺口——23:30 说「两小时后」AI 给的次日 01:30 due
  // 被 anchorMomentToToday 按「无日期词」整平移回当天 01:30（已过期，立即误报）；落 soon 桶后
  // 锚定豁免生效，规则兜底由 relativeOffsetMinutes 给确定性分钟锚
  if (relativeOffsetMinutes(text) != null) return "soon";
  if (relativeOffsetDays(text) != null) return "soon";
  if (/待会|等会|等一下|晚点|稍后/.test(text)) return "soon";
  // "一会儿"仅在未来语境算（"过一会儿再去"）；"刚做了一会儿拉伸"是过去
  if (/(过|等|再)一会儿|一会儿(再|之后|就去|要)/.test(text)) return "soon";
  // 计划/准备只认动词性用法（"准备去开会"是未来，"工作准备/准备工作"是名词），
  // 裸词会误伤补记（如"今天9:10到9:30工作准备+喝水"被拐进未来分支），已交给 LLM 结合当前时间判定。
  // "记得"排除回忆性搭配（小时候/以前/上次/当年/那次/起来…）：裸词会把"记得小时候…"拐进未来分支；
  // 否定式「不/没记得」是回忆陈述不是计划（"我不记得带钥匙了"曾产出 now+1h 的幻影提醒，
  // 规则兜底路径 GLM 熔断时才发作，十九轮补——思路同 mood-rules NEGATORS）
  if (/(计划[着去要下]|打算|准备[去要下]|(?<![不没未甭])记得(?!(小|以|上|当|曾|那|有|起|很))|记得到|要[去办交开]|得去)/.test(text)) return "soon";
  return null;
}

/**
 * 相对日引用检测（过去/当日）：昨天/前天/大前天/上周X/上礼拜X/周X。
 * 返回相对今天的天数偏移（≤0），null=没有显式相对日。周制：周一为一周开始。
 * 优先级：具体日词（今天/前天/昨天系）> 周X——旧版周X分支排在前，
 * 「今天周三开了会」在今天非周三时被推算成上周三；显式月日（9月30号/2026-10-01）
 * 必须完全压过周X相对推算：周X分支按本周/上周推算会无视显式日期
 * （十四轮 P2 实测「9月30号周三交了房租」按记账日锚成上周三、错 7 天）。
 */
export function detectDayRef(text: string, now: Date): number | null {
  if (/今天|今日/.test(text)) return 0;
  if (/大前天/.test(text)) return -3;
  if (/前天/.test(text)) return -2;
  if (/昨天|昨晚|昨夜|昨儿/.test(text)) return -1;
  // 显式月日/年份日期在场：周X 词一律不作相对推算（返回 null 交回显式日期分支），
  // 也不能落到 上周 -7 兜底（「9月30号周三」≠上周）。
  // 裸「N号+周X」同守（十五轮 P2：旧守卫只认 M月N号/完整日期，「15号周三交了房租」
  // 仍被周X分支劫持成上周X——显式日 15 号被丢、偏 22 天；lookbehind 与 EXPLICIT_DAY_RE /
  // parse.ts 裸 N号 分支同款，防「3号球衣」类编号误伤；lookahead 同款防「2号线」类线址编号）
  if (
    /\d{1,2}\s*月\s*\d{1,2}\s*[号日]|\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}/.test(text) ||
    /(?<![月年\d个件条辆间套位张台页只支])\d{1,2}\s*[号日](?![线楼层栋路室排座门])/.test(text)
  )
    return null;
  const wd = text.match(/(上)?(?:周|礼拜|星期)([一二三四五六日天])/);
  if (wd) {
    const target = WEEKDAYS[wd[2]]; // 0=周日
    const posInWeek = target === 0 ? 6 : target - 1; // 周一=0 … 周日=6
    const daysIntoWeek = (cstDayIdx(now) + 3) % 7; // 北京日序推星期（周一=0），不依赖宿主时区（epoch 当天为周四）
    if (wd[1]) return -(daysIntoWeek + 7 - posInWeek); // 上周X
    let offset = posInWeek - daysIntoWeek; // 本周内的 X 相对今天
    if (offset > 0) offset -= 7; // 本周还没到的周X，过去语境视为上周 X
    return offset;
  }
  if (/上周|上礼拜|上星期/.test(text)) return -7;
  return null;
}

/** 话术中的钟点："三点"/"15:30"/"7点半"/"6.30"(配合 period 换算 12/24h)；点后分钟支持中文数字
 * （"十一点五十"→11:50，十五轮收口：旧版只认 半/阿拉伯，中文分钟被静默丢成整点） */
export function parseClock(text: string, period: PeriodHint | null): { hour: number; minute: number } | null {
  const m = text.match(
    /(\d{1,2}|[一二两三四五六七八九十]+)\s*(?:[点时](?!点)\s*(半|[一二两三四五六七八九十]{1,3}|\d{1,2})?\s*分?|[.:：](\d{2}))/,
  );
  if (!m) return null;
  // 叠字守卫：中文数字叠字（"一一"）非数字；单字（一/三）与阿拉伯数字（11/22）合法
  if (m[1].length > 1 && !/^[0-9]+$/.test(m[1]) && [...m[1]].every((c) => c === m[1][0])) return null;
  // 约数并列（"两三点""七八点"）先于 cnToNumber：cnToNumber 按复合进位把「两三」直读成 23 点——
  // 两位均为独立数码且不同字时按约数取末位（区间上界），与 relativeOffsetDays/duration 同款
  const approx = /^([一两俩二三四五六七八九])([一两俩二三四五六七八九])$/.exec(m[1]);
  const n = approx && approx[1] !== approx[2] ? cnToNumber(approx[2]) : cnToNumber(m[1]);
  if (n === null || n > 23) return null;
  let hour = n;
  // "点半"→30；点后数字（阿拉伯/中文）→分钟；点号两位（6.30）→30 分（须两位数，避免"5.5小时"误伤）
  const minute = m[2] ? (m[2] === "半" ? 30 : cnToNumber(m[2]) ?? 0) : m[3] ? parseInt(m[3], 10) : 0;
  if (minute > 59) return null;
  // "下午三点"→15、"晚上八点"→20（小时制+下午/晚上偏移）
  if (hour < 12 && (period === "afternoon" || period === "evening" || period === "night")) hour += 12;
  // "中午1点/中午两点半"→13:00/14:30：中文「中午」的 1~2 点指午后（11/12 点仍是上午/正午不加），
  // 旧实现 noon 不在 +12 偏移表里，规则兜底路径会把「中午1点和老王吃饭」落成凌晨 01:00 块
  if (hour >= 1 && hour <= 2 && period === "noon") hour += 12;
  // "晚上12点"是午夜非正午：映射为 24（=次日 0 点）——atHour 的 setUTCHours(24) 自然进位到次日凌晨，
  // 「明天晚上12点睡觉」落次日零点而非当天正午
  if (hour === 12 && (period === "evening" || period === "night")) hour = 24;
  return { hour, minute };
}

/**
 * 显式钟点区间："6.30-7.30"/"7点半到8点半"/"9:00~11:00" 等。
 * 以区间分隔符（到/至/-/~/—）切两半，各自解析一个钟点；解析不出两个钟点则返回 null。
 * 12/24h 偏移规则：起点在 pm 时段且 <12 → +12；终点 +12 后仍晚于起点才 +12
 * （"下午2.30到3.30"→14:30-15:30；"晚上10.30到6.30"→22:30-次日06:30，不把 6 点抬成 18 点）
 * 混时段区间（"上午10点到下午3点"/"晚上11点到凌晨2点"）按**片段自带**的时段词解析：
 * 整句单一时段会把另一端解析成垃圾（旧版：上午10点-下午3点 → end≤start 跨日 +24h → 17 小时块；
 * 晚上11点-凌晨2点 → 起点不加 12 → 上午 11 点起步的 15 小时"睡眠"）。
 */
export function parseClockRange(
  text: string,
  period: PeriodHint | null,
): { start: { hour: number; minute: number }; end: { hour: number; minute: number } } | null {
  const parts = text.split(/\s*(?:到|至|~|—|–|-)\s*/);
  if (parts.length !== 2) return null;
  const pmish = period === "afternoon" || period === "evening" || period === "night";
  const a = parseClock(parts[0], detectPeriod(parts[0]) ?? (pmish ? period : null));
  // 终点只在片段自带时段词（"下午3点"/"凌晨2点"）时按片段解析；裸钟点（"6.30"/"3.30"）
  // 仍传 null 走下方 endHour 钳制——"晚上10.30到6.30"的 6 点不能因整句 evening 被抬成 18 点
  const b = parseClock(parts[1], detectPeriod(parts[1]));
  if (!a || !b) return null;
  let endHour = b.hour;
  // 终点"12点"在下午/晚上语境指午夜（24:00）非正午——"晚上10点半到12点"= 22:30–24:00；
  // 旧版漏判使 end<=start 被跨日 +24h 成次日正午，块长膨胀成 13.5 小时
  if (pmish && b.hour === 12) endHour = 24;
  // 终点抬 pm 用 >=（等钟点区间："下午1点到1点半"= 13:00–13:30）：
  // 旧严格 > 把等钟点判成 end<start 跨日 +24h，膨胀成 24.5h 块；起点本身已过正午
  //（"中午12点到1点"，noon 不在 pmish）同样适用。起点 10/11 点 + noon 语境 + 裸终点
  // ≤2 点同理按午后抬（"中午11点到1点"= 11:00–13:00 而非跨日 +14h；二十轮：
  // pmish 排除 noon 且 a.hour>=12 不含 11，午饭区间被误判成跨日）
  else if (
    (pmish || a.hour >= 12 || (period === "noon" && a.hour >= 10)) &&
    b.hour < 12 &&
    b.hour + 12 >= a.hour
  )
    endHour = b.hour + 12;
  return { start: a, end: { hour: endHour, minute: b.minute } };
}

const WEEKDAYS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/** N(个半)小时后 / 半小时后 / N钟头后 → 未来分钟偏移（null=非该形态）。
 *  与 relativeOffsetDays 同族：detectFuture 用于「soon」桶判定（锚定豁免），
 *  inferFuture 用于规则兜底的确定性分钟锚（旧版「两小时后」落 now+1h）。 */
export function relativeOffsetMinutes(text: string): number | null {
  // 数字组支持小数：「1.5小时后开会」旧版被 lookbehind(?<![\d.]) 整段拒绝 → detectFuture 漏判未来
  // （lookbehind 保留，防「12.5小时后」被尾部 5 抢配）；小数只走 parseFloat，不经 cnToNumber
  const m = text.match(/(?<![\d.])([一两俩二三四五六七八九十\d]+(?:\.\d+)?|\d+\.\d+)\s*个?半?\s*(?:小时|钟头)\s*(?:之|以)?后/);
  if (m) {
    if (/^\d+(?:\.\d+)?$/.test(m[1])) {
      const d = parseFloat(m[1]);
      if (d > 0 && d <= 24) return /个?半/.test(m[0]) ? Math.round(d * 60) + 30 : Math.round(d * 60);
      return null;
    }
    const n = cnToNumber(m[1]);
    if (n === null || n <= 0 || n > 24) return null;
    return /个?半/.test(m[0]) ? n * 60 + 30 : n * 60;
  }
  if (/半\s*(?:小时|钟头)\s*(?:之|以)?后/.test(text)) return 30;
  return null;
}

/** N天后/N周(礼拜/星期)后/N个月后 → 未来偏移天数（月按 30 天近似）；解析不出 null。
 *  「3天后交报告」类相对偏移：AI 路径用于锚定豁免，规则兜底路径用于确定性未来锚。
 *  约数并列（两三天/三四天/七八天）：cnToNumber 按复合进位误读成 23/34/78——两位均为
 *  独立数码（无十/百骨架）时按约数处理取末位（区间上界保守估计）。「半个月后」≈15 天。 */
export function relativeOffsetDays(text: string): number | null {
  if (/半个月后/.test(text)) return 15;
  const m = text.match(/([一两俩二三四五六七八九十百\d]+)\s*(个?月|年|(?:礼拜|星期|周)|天)\s*(?:之|以)?后/);
  if (!m) return null;
  // 约数并列判定先于 cnToNumber：「两三」是「两三天」而非 23 天
  const approx = m[1].match(/^([一两俩二三四五六七八九])([一两俩二三四五六七八九])$/);
  const n = approx ? cnToNumber(approx[2]) : cnToNumber(m[1]);
  if (n === null || n <= 0) return null;
  if (m[2] === "天") return n <= 365 ? n : null;
  if (m[2] === "周" || m[2] === "礼拜" || m[2] === "星期") return n <= 52 ? n * 7 : null;
  if (m[2] === "年") return n <= 1 ? n * 365 : null; // 一年后；多年后离打卡语境过远不锚
  return n <= 12 ? n * 30 : null;
}

const MAX_SPAN_MS = 366 * 24 * 3600_000;

/** 校验 AI 直推的时刻（北京时间本地串）：非法/距当前超 366 天 → null */
export function resolveMoment(s: string | null | undefined, now: Date): Date | null {
  if (!s) return null;
  // 契约约定无时区串即北京本地时间：显式补 +08:00 再解析，
  // 否则 new Date(s) 按宿主时区解释，UTC 宿主上整体偏 8 小时。
  // 已带时区（Z/±HH:MM）或纯日期串维持原样（后者按 ECMAScript 规范本就与宿主时区无关）。
  // naive 形态放宽到斜杠/点分隔与单位数月日时（模型漂移常见变体）——放任 new Date() 走宿主
  // 时区，UTC 容器上偏 8 小时且 CST 本机永不复现（十九轮补）；归一后再补 +08:00
  const t = s.trim();
  const naive = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  // 假日历回读（与 parseYmd/parseCstTime 同族收口，二十轮）：resolveMoment 直接消费模型输出的
  // schedule/todo 时间——LLM 月末幻觉（4月31日/2月30日）经 new Date 静默进位成次月块，须拒之
  const d = naive
    ? new Date(
        `${naive[1]}-${naive[2].padStart(2, "0")}-${naive[3].padStart(2, "0")}T${naive[4].padStart(2, "0")}:${naive[5]}:${naive[6] ?? "00"}+08:00`,
      )
    : new Date(t);
  if (isNaN(d.getTime())) return null;
  if (naive) {
    const cst = new Date(d.getTime() + 8 * 3600_000);
    if (
      cst.getUTCFullYear() !== Number(naive[1]) ||
      cst.getUTCMonth() + 1 !== Number(naive[2]) ||
      cst.getUTCDate() !== Number(naive[3]) ||
      cst.getUTCHours() !== Number(naive[4])
    )
      return null;
  }
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

/** 北京时间锚点：把 base 平移到 CST 墙钟的 hour:minute（UTC setter + 8h，禁用本地 setHours） */
function atHour(base: Date, hour: number, minute = 0): Date {
  const CST_MS = 8 * 3600_000;
  const d = new Date(base.getTime() + CST_MS);
  d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60) + minute, 0, 0);
  return new Date(d.getTime() - CST_MS);
}

// ---------- 日期锚定（用户规则：话术没写具体是哪一天 → 一律按当天） ----------

/** 话术是否显式提到某个日期（今天/昨天/明天/周X/上周/下周/2026-09-20/9月20日/裸「3号」「15日」…）。
 * 裸 N号/N日 与 parse.ts occurredDate 同款 lookbehind——「3号」是显式日期，
 * 缺此分支会让模型给对的区间被 anchorRangeToToday 整天平移到今天；
 * 上/本/下月 N号、N天/周/月/年(之/以)后、半个月后、月初同义（十一轮词表收口：hasExplicitDayRef
 * 只表「话术带了日期信息」，宁全勿缺——漏了就会被锚定拉回今天；十三轮补「3天之后/一个月以后」
 * 变体；数字类与 parseDuration 同口径含 俩/百，单位含 年，另收「半个月后」） */
const EXPLICIT_DAY_RE =
  /(今天|今日|昨天|昨晚|昨夜|昨儿|前天|大前天|明天|明早|明晚|明儿|后天|大后天|上周|上礼拜|上星期|下周|下礼拜|下星期|周[一二三四五六日天末]|礼拜[一二三四五六日天末]|星期[一二三四五六日天末]|\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|(?:上|本|下)个?月\s*[一两俩二三四五六七八九十\d]{1,3}\s*[号日]|[零一两俩二三四五六七八九十百\d]+\s*(?:天|周|礼拜|星期|个?月|年)\s*(?:之|以)?后|半个月后|月初|月底|月末|(?<![月年\d个件条辆间套位张台页只支])\d{1,2}\s*[号日](?![线楼层栋路室排座门]))/;

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
 * 显式月日（M月N号，可带 YYYY 年）→ 过去某北京日 00:00 的锚；未来/非法日期 → null。
 * detectDayRef 的显式日期守卫跳过周X推算后，话术真带的「9月30号」不该被丢掉：
 * 补记日程块应落在显式日（路径 0.5/0.6 消费），而非被泛化锚到今天。
 */
function explicitDateBase(text: string, now: Date): Date | null {
  const md = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/.exec(text);
  if (!md) return null;
  const mo = Number(md[2]);
  const day = Number(md[3]);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const CST_MS = 8 * 3600_000;
  const bj = new Date(now.getTime() + CST_MS);
  const year = md[1] ? Number(md[1]) : bj.getUTCFullYear();
  // 日历回读校验在 UTC 恒定时刻上做（先平 -8h 会读出前一天恒失败），再转北京 00:00 锚
  const candUtc = new Date(Date.UTC(year, mo - 1, day));
  if (candUtc.getUTCDate() !== day) return null;
  let cand = new Date(candUtc.getTime() - CST_MS);
  if (!md[1] && cand.getTime() > now.getTime()) cand = new Date(Date.UTC(year - 1, mo - 1, day) - CST_MS);
  if (cand.getTime() > now.getTime()) return null;
  return cand;
}

/**
 * 月历话术 → 确定性月历日锚（该北京日 00:00 的 Date，供 atHour 落钟点；无月历词 → null）。
 * 支持：月底/月末（末日）、下个月(份)（1 号）、月初（下一个 1 号，今天恰为 1 号则今天）、
 * 下(个)月 N 号（显式日，1~28）。旧版缺「下月15号」显式日与「月初」：
 * 「下个月15号交房租」锚成 1 号偏 14 天、「月初还贷」落 now+1h（十一轮 P2 同批收口）。
 * 北京口径全用 UTC getter/setter 推算（禁本地 getter）——月序合成跨年自然进位。
 */
function monthDayBase(text: string, now: Date): Date | null {
  const monthEnd = /月底|月末/.test(text);
  const monthStart = /月初/.test(text);
  const nextMonth = /下个月份?|下月份?/.test(text);
  // 显式日直接取首个正则的捕获组：旧版二次全文匹配会取到全文第一个「N号」
  // （「10号发的工资，下个月15号交房租」锚成 11-10），十一轮修正
  const dayNumM = text.match(/下个?月份?[^号日\d]{0,2}([一两俩二三四五六七八九十\d]{1,3})\s*[号日]/);
  if (!monthEnd && !monthStart && !nextMonth && !dayNumM) return null;
  const CST_MS = 8 * 3600_000;
  const bj = new Date(now.getTime() + CST_MS);
  const monthSeqOf = (m0: number) => new Date(Date.UTC(Math.floor(m0 / 12), m0 % 12, 1) - CST_MS);
  // 下(个)月 N 号：显式日优先于 月初/月底 词。29~31 用日历回读校验（11 月有 30 号、
  // 2 月无 30 号）——真实存在则用之，不存在则放弃显式日（return null 让路钟点/now+1h），
  // 不再静默落回 day=1 兜底（旧版「下个月30号还房贷」被锚成下月 1 号，偏 29 天）
  const dayNum = dayNumM ? cnToNumber(dayNumM[1]) : null;
  if (nextMonth && dayNum != null && dayNum >= 1 && dayNum <= 31) {
    const m0 = bj.getUTCFullYear() * 12 + bj.getUTCMonth() + 1; // 次月序
    // 回读校验必须在 UTC 恒定时刻上做：先 -CST_MS 再 getUTCDate() 会读出前一天，
    // 显式日分支恒 null（「下个月15号交房租」实际一直落 now+1h——十四轮修正的存量 bug）
    const candUtc = new Date(Date.UTC(Math.floor(m0 / 12), m0 % 12, dayNum));
    if (candUtc.getUTCDate() === dayNum) return new Date(candUtc.getTime() - CST_MS);
    return null;
  }  // 月初（无下个月词）= 下一个 1 号；今天恰为 1 号则今天
  if (monthStart && !nextMonth && dayNum == null) {
    const m0 = bj.getUTCFullYear() * 12 + bj.getUTCMonth() + (bj.getUTCDate() === 1 ? 0 : 1);
    return monthSeqOf(m0);
  }
  const m0 = bj.getUTCFullYear() * 12 + bj.getUTCMonth() + (nextMonth ? 1 : 0); // 目标月序（0-based）
  const y = Math.floor(m0 / 12);
  const mo = m0 % 12;
  const day = monthEnd ? new Date(Date.UTC(y, mo + 1, 0)).getUTCDate() : 1; // 月末 = 次月 0 日
  return new Date(Date.UTC(y, mo, day) - CST_MS);
}

/**
 * AI 区间硬锚定到"今天"：话术无任何日期词且非未来话术时，模型偶发把当天区间
 * 挪到明天/昨天（如 17:22 说"下午2点到6点"被写成次日）——按整天平移保钟点。
 * 例外：凌晨（0-5 点）补记白天的区间归昨天，与提示词规则一致。
 */
export function anchorRangeToToday<T extends { start: Date; end: Date }>(range: T, text: string, now: Date): T {
  if (hasExplicitDayRef(text) || detectFuture(text) !== null) return range;
  const diff = cstDayIdx(now) - cstDayIdx(range.start);
  // 跨午夜区间且终点落在今天（早晨补记昨晚睡眠「10.30到6.30」）→ 是昨天的真实记录，不前移；
  // 旧版只认 diff===1，diff≥2 的跨午夜漂移（模型把起点也挪早）会被整体平移出未来块
  if (diff === 0 || (diff >= 1 && cstDayIdx(range.end) === cstDayIdx(now))) return range;
  if (diff === 1 && cstHour(now) < 5) return range;
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
    // 月底/下个月/下月N号/月初：月历确定性锚（默认 20:00 回顾锚；话术带显式钟点/时段则让位，与下周X分支同口径）
    const monthBase = monthDayBase(text, now);
    // N天后/N周后/N个月后：相对偏移确定性锚（旧版落 now+1h，「3天后交报告」提醒立即误报）
    const offsetDays = monthBase ? null : relativeOffsetDays(text);
    // N(个半)小时后/半小时后：分钟级确定性锚（「两小时后取快递」= now+2h，而非 now+1h 泛化）
    const offsetMin = monthBase || offsetDays != null ? null : relativeOffsetMinutes(text);
    if (monthBase) {
      start = atHour(monthBase, clock ? clock.hour : period ? PERIOD_ANCHORS[period] : 20, clock?.minute ?? 0);
    } else if (offsetDays != null) {
      const base = new Date(now.getTime() + offsetDays * 24 * 3600_000);
      start = atHour(base, clock ? clock.hour : period ? PERIOD_ANCHORS[period] : 9, clock?.minute ?? 0);
    } else if (offsetMin != null) {
      start = new Date(now.getTime() + offsetMin * 60_000);
    } else if (clock) {
      // 待会儿/计划：有钟点且在今天未来 → 用之；否则 now + 1h
      start = atHour(now, clock.hour, clock.minute);
      if (start <= now) start = new Date(start.getTime() + 24 * 3600_000);
    } else {
      start = new Date(now.getTime() + 60 * 60_000);
    }
  } else {
    // 目标日：明天/后天直接加天数；下周先定位到下周一再加星期偏移
    if (future === "nextWeek") {
      const cstWday = (cstDayIdx(now) + 4) % 7; // 北京星期（周日=0），不依赖宿主时区
      const daysToMonday = ((8 - cstWday) % 7) || 7; // 下周一
      start = new Date(now.getTime() + daysToMonday * 24 * 3600_000);
      const wd = text.match(/(?:下周|下礼拜|下星期)([一二三四五六日天])/);
      if (wd) {
        const target = WEEKDAYS[wd[1]]; // 0=周日
        const offset = target === 0 ? 6 : target - 1; // 周一为 0
        start = new Date(start.getTime() + offset * 24 * 3600_000);
      }
    } else {
      const days = future === "tomorrow" ? 1 : future === "twoDaysAfter" ? 3 : 2;
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
    // 显式月日在场（detectDayRef 已守卫跳过周X）→ 块锚定该日，凌晨补记回退不再参与
    const explicitBase = dayRef === null ? explicitDateBase(text, now) : null;
    // 无相对日且在凌晨（<5点）补记白天的区间 → 归昨天
    const back = dayRef !== null ? -dayRef * 24 * 3600_000 : cstHour(now) < 5 ? 24 * 3600_000 : 0;
    const base = explicitBase ?? new Date(now.getTime() - back);
    const start = atHour(base, range.start.hour, range.start.minute);
    let end = atHour(base, range.end.hour, range.end.minute);
    if (end <= start) {
      end = new Date(end.getTime() + 24 * 3600_000); // 跨天区间（如 22.30-6.30）
      // 中午前补记昨晚睡眠（07:30 说「10.30到6.30」，起点还在未来）→ 归昨晚，
      // 而非记成今晚的未来块；晚间说（21:00 说「11点到1点」）则按今晚计划保留
      if (start.getTime() > now.getTime() && cstHour(now) < 12) {
        const back1 = 24 * 3600_000;
        return {
          mode: "explicit",
          start: new Date(start.getTime() - back1),
          end: new Date(end.getTime() - back1),
          durationMin: Math.round((end.getTime() - start.getTime()) / 60_000),
        };
      }
    }
    return {
      mode: "explicit",
      start,
      end,
      durationMin: Math.round((end.getTime() - start.getTime()) / 60_000),
    };
  }

  // 0.6) 显式相对日（昨天/前天/上周X/周X）：日期 = 今天偏移，时刻 = 钟点/时段锚点（无则按 20:00 回顾锚）
  //      显式月日（9月30号周三，周X已被 detectDayRef 守卫跳过）同走此路径，锚定该日
  const refBase = dayRef !== null ? new Date(now.getTime() + dayRef * 24 * 3600_000) : explicitDateBase(text, now);
  if (refBase !== null) {
    const base = refBase;
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

  // 1) 有相对时段 → 锚点起 + 时长；话术带显式钟点时优先钟点（与路径 0/0.6/未来推断同口径——
  // 「下午3点开了个会」应 15:00 起，而不是泛化锚点 14:00）
  if (period && period !== "now") {
    const clock = parseClock(text, period);
    let anchor = clock ? atHour(now, clock.hour, clock.minute) : atHour(now, PERIOD_ANCHORS[period]);
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
