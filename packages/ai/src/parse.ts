/**
 * 解析管线：一句话 → 多域结构化结果
 * 双引擎：LLM（有 API Key）+ 规则引擎（dry-run 兜底/离线/单测）
 */
import { chat, extractJson, hasApiKey } from "./glm";
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt } from "./prompt";
import {
  LlmExtraction, ParseResult, ACTIVITY_IDS,
  type LlmExtraction as LlmExtractionT, type ParseResult as ParseResultT,
} from "./schema";
import { inferTimeBlock, detectPeriod, detectFuture } from "./time-infer";
import { parseAmountCents, parseDuration } from "./duration";

export interface ParseOptions {
  now?: Date;
  /** 类别默认时长表（activityId → 分钟）；缺省 30 */
  defaults?: Partial<Record<(typeof ACTIVITY_IDS)[number], number>>;
  /** 强制使用规则引擎（测试用） */
  forceRules?: boolean;
}

// ---------- 规则引擎（dry-run） ----------

const RULE_KEYWORDS: Array<[RegExp, LlmExtractionT["activity"]]> = [
  [/午睡|睡觉|补觉/, "sleep"],
  [/通勤|路上|地铁|公交|打车/, "commute"],
  [/开会|评审|周报|报告|邮件|客户|上班|加班|项目/, "work"],
  [/学|看书|阅读|读书|英语|上课|刷题|三章/, "study"],
  [/跑|撸铁|健身|锻炼|球类|散步|拉伸/, "fitness"],
  [/抖音|电影|游戏|刷手机|逛街/, "fun"],
  [/打扫|买菜|超市|做饭|洗衣|房间|垃圾/, "chores"],
  [/吃饭|聊|电话|爸妈|老王|小李|朋友|同事|随礼|满月|搬家|帮忙/, "social"],
];

const PEOPLE_RE = [/老王/g, /爸妈/g, /小李/g, /朋友/g, /同事(?:小李)?/g];

/** 心情规则表：[匹配词, 心情词, 基准情绪分]（规则引擎兜底 & LLM 缺 score 时的补全依据） */
const MOOD_RULES: Array<[RegExp, string, number]> = [
  [/生气|气死|愤怒|火大|气人/, "生气", -80],
  [/难过|伤心|失落|想哭|emo|崩溃/, "难过", -70],
  [/委屈|心酸/, "委屈", -60],
  [/孤独|寂寞/, "孤独", -60],
  [/焦虑|压力|紧张|担心|慌|发愁/, "焦虑", -60],
  [/烦|暴躁|郁闷|抓狂|无语/, "烦躁", -60],
  [/累|疲惫|困|犯困|乏力|虚/, "疲惫", -40],
  [/幸福|感恩|感谢|幸运|幸运儿/, "幸福", 70],
  [/兴奋|激动|期待|迫不及待/, "兴奋", 80],
  [/开心|高兴|快乐|心情好|心情不错|心情真好|爽|美滋滋/, "开心", 60],
  [/满足|充实|值得|值了|有成就感|骄傲/, "满足", 60],
  [/放松|舒服|惬意|治愈|解压|舒坦/, "放松", 50],
  [/平静|还行|一般|淡淡/, "平静", 10],
];

/** 规则引擎心情识别：返回 null=无情绪色彩 */
export function ruleMood(text: string): { label: string; score: number } | null {
  for (const [re, label, score] of MOOD_RULES) {
    if (re.test(text)) return { label, score };
  }
  return null;
}

/**
 * 规则引擎标题：剥离时间/金额/时段等修饰成分，保留事项本身（不截尾）。
 * "刚跑完步，练了40分钟" → "刚跑完步"；"明天下午三点去看牙医" → "去看牙医"
 */
function makeTitle(text: string): string {
  const cleaned = text
    .replace(/(待会儿?|等会儿?|一会儿|晚点|稍后|明天|后天|下周[一二三四五六日天]?|早上|上午|中午|下午|傍晚|晚上|凌晨|刚刚?)/g, " ")
    .replace(/\d{1,2}\s*[点:：时]\d{0,2}\s*分?/g, " ")
    .replace(/(\d+|[一二两俩三四五六七八九十百]+)\s*(个半|半)?\s*(个小时|小时|钟头|分钟|分|min)/g, " ")
    .replace(/(花费|消费|花|随|付|充值|打款)了?\s*\d+(?:\.\d+)?\s*(块|元|钱)?/g, " ")
    .replace(/\d+(?:\.\d+)?\s*(块|元)/g, " ")
    .replace(/(记得|要|打算|计划|准备)/g, " ")
    .replace(/[\s，,。！!？?、；;]+/g, " ")
    .trim()
    .replace(/(练了|聊了|看了|搞了|弄了|花了|用了)$/u, "")
    .trim();
  return (cleaned || text).slice(0, 20);
}

function ruleExtract(text: string): LlmExtractionT {
  let activity: LlmExtractionT["activity"] = "other";
  for (const [re, act] of RULE_KEYWORDS) {
    if (re.test(text)) { activity = act; break; }
  }
  const amount = parseAmountCents(text);
  // 人物去重："同事小李"与"小李"同时命中时保留更短的称呼
  const rawNames = PEOPLE_RE.map((re) => [...text.matchAll(re)].map((m) => m[0])).flat();
  const people = [...new Set(rawNames)]
    .filter((n) => !rawNames.some((m) => m !== n && m.includes(n)))
    .map((name) => ({ name, event: undefined }));
  const mood = ruleMood(text);
  // status 启发式：没命中任何活动词、没说时长/金额/人物，只是带情绪的一句话 → 纯动态
  const statusLike = activity === "other" && !parseDuration(text) && amount === null && people.length === 0 && mood !== null;
  return {
    recordType: detectFuture(text) ? "future" : statusLike ? "status" : "past",
    activity,
    title: makeTitle(text),
    periodHint: detectPeriod(text) ?? "now",
    mood: mood ?? { label: null, score: null },
    finance: amount !== null
      ? {
          hasAmount: true,
          amountCents: -amount,
          category: /随|礼|满月/.test(text)
            ? "人情往来"
            : /超市|买菜|购物/.test(text)
              ? "购物"
              : "餐饮",
          counterparty: people[0]?.name,
        }
      : { hasAmount: false },
    people,
    ambiguity: null,
  };
}

// ---------- 主入口 ----------

export async function parseInput(text: string, opts: ParseOptions = {}): Promise<ParseResultT> {
  const now = opts.now ?? new Date();
  now.setSeconds(0, 0); // 时间对齐到整分钟：时间轴记录到分即可
  const useLlm = !opts.forceRules && hasApiKey();

  let ext: LlmExtractionT;
  let confidence: number;

  if (useLlm) {
    const raw = await chat({
      system: EXTRACT_SYSTEM_PROMPT,
      user: buildExtractUserPrompt(text, now.toISOString()),
    });
    const parsed = LlmExtraction.safeParse(extractJson(raw));
    if (parsed.success) {
      ext = parsed.data;
      confidence = 0.9;
    } else {
      console.warn("[ai] LLM 输出未通过校验，规则兜底：", parsed.error.issues.slice(0, 3));
      ext = ruleExtract(text); // LLM 输出不合格 → 规则兜底
      confidence = 0.5;
    }
  } else {
    ext = ruleExtract(text);
    confidence = 0.5;
  }

  // 时长：LLM 抽取优先，回退到话术再解析，最后类别默认
  const defaults = { sleep: 480, fitness: 60, social: 60, chores: 60, work: 60, study: 60, fun: 30, commute: 30, other: 30, ...opts.defaults };
  const durationFromText = parseDuration(text);
  const durationMin = ext.durationMin ?? durationFromText ?? defaults[ext.activity];
  // 防御：过滤模型输出的占位人名（"省略"/"无"/空）
  const people = ext.people.filter((p) => p.name && !/^(省略|无|没有|null|none)$/i.test(p.name.trim()));

  // 未来话术 → 不钳制的计划时刻（上层创建 TODO）；过去/当前 → 照常推断并钳制；status → 时间无意义，仅留档
  const tb = inferTimeBlock(text, now, durationMin, ext.periodHint, ext.recordType === "future");

  // 意图分流：future 优先（"明天要交报告了好焦虑"是待办+焦虑，不是状态）
  const intent: ParseResultT["intent"] =
    ext.recordType === "future" || tb.mode === "future"
      ? "todo"
      : ext.recordType === "status"
        ? "status"
        : "schedule";

  // 心情：LLM 词优先；score 缺失时按规则基准分补全
  const moodLabel = (ext.mood.label ?? "").trim() || null;
  const moodScore = moodLabel ? (ext.mood.score ?? ruleMood(moodLabel)?.score ?? 0) : null;

  return ParseResult.parse({
    activity: ext.activity,
    title: ext.title,
    time: {
      mode: tb.mode,
      start: tb.start.toISOString(),
      end: tb.end.toISOString(),
      durationMin: tb.durationMin,
      confidence,
    },
    intent,
    mood: { label: moodLabel, score: moodScore },
    finance: ext.finance,
    people,
    ambiguity: ext.ambiguity ?? null,
    engine: useLlm ? "llm" : "rules",
  });
}
