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
  [/开会|评审|周报|邮件|客户|上班|加班|项目/, "work"],
  [/学|看书|阅读|读书|英语|上课|刷题|三章/, "study"],
  [/跑|撸铁|健身|锻炼|球类|散步/, "fitness"],
  [/抖音|电影|游戏|刷手机|逛街/, "fun"],
  [/打扫|买菜|超市|做饭|洗衣|房间|垃圾/, "chores"],
  [/吃饭|聊|电话|爸妈|老王|小李|朋友|同事|随礼|满月|搬家|帮忙/, "social"],
];

const PEOPLE_RE = [/老王/g, /爸妈/g, /小李/g, /朋友/g, /同事(?:小李)?/g];

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
  return {
    recordType: detectFuture(text) ? "future" : "past",
    activity,
    title: makeTitle(text),
    periodHint: detectPeriod(text) ?? "now",
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

  // 未来话术 → 不钳制的计划时刻（上层创建 TODO）；过去/当前 → 照常推断并钳制
  const tb = inferTimeBlock(text, now, durationMin, ext.periodHint, ext.recordType === "future");

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
    createsTodo: tb.mode === "future",
    finance: ext.finance,
    people,
    ambiguity: ext.ambiguity ?? null,
    engine: useLlm ? "llm" : "rules",
  });
}
