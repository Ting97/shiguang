/**
 * 解析管线：一句话 → 五域独立结构化结果
 * 双引擎：LLM（有 API Key）+ 规则引擎（dry-run 兜底/离线/单测）
 * 时间戳始终由确定性引擎计算（inferTimeBlock），不让模型编时间
 */
import { chat, extractJson, hasApiKey } from "./glm";
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt } from "./prompt";
import {
  LlmExtraction, ParseResult, ACTIVITY_IDS,
  type LlmExtraction as LlmExtractionT, type ParseResult as ParseResultT,
} from "./schema";
import { inferTimeBlock, detectPeriod, detectFuture } from "./time-infer";
import { parseAmountCents, parseDuration } from "./duration";
import { ruleMood } from "./mood-rules";

export interface ParseOptions {
  now?: Date;
  /** 类别默认时长表（activityId → 分钟）；缺省 30 */
  defaults?: Partial<Record<(typeof ACTIVITY_IDS)[number], number>>;
  /** 强制使用规则引擎（测试用） */
  forceRules?: boolean;
}

// ---------- 规则引擎（dry-run） ----------

const RULE_KEYWORDS: Array<[RegExp, LlmExtractionT["schedule"]["activity"]]> = [
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

const DIET_RE = /(吃了|吃了个|吃了点|吃了顿|吃饭|喝了一?杯|喝了杯|喝了瓶|早茶|早饭|早餐|午饭|晚餐|晚饭|下午茶|加餐|夜宵|宵夜|奶茶|咖啡|汉堡|烧烤|火锅|面条|牛肉面|米饭|泡面|外卖|零食|可乐|雪碧|啤酒|水果|苹果|香蕉|火腿肠)/;
/** 明确无热量的饮品不计入饮食 */
const DIET_EXCLUDE_RE = /(白开水|矿泉水|喝了口?水|买了瓶水|纯净水)/;

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
  let activity: LlmExtractionT["schedule"]["activity"] = "other";
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
  const isFuture = detectFuture(text) !== null;
  // 日程适用启发式：命中活动词/有显式时长/有饮食（吃饭喝水都占时间）→ 已发生的"事"；纯感想不适用
  const dietHit = DIET_RE.test(text) && !DIET_EXCLUDE_RE.test(text);
  const scheduleApplicable = !isFuture && (activity !== "other" || parseDuration(text) !== null || dietHit);
  return {
    reasoning: {},
    schedule: {
      applicable: scheduleApplicable,
      activity,
      title: makeTitle(text),
      durationMin: parseDuration(text) ?? undefined,
      periodHint: detectPeriod(text) ?? "now",
      confidence: scheduleApplicable ? 0.7 : 0.5,
    },
    todo: { applicable: isFuture, confidence: isFuture ? 0.8 : 0.6 },
    finance: amount !== null
      ? {
          hasAmount: true,
          direction: /收到|到账|工资|红包|奖金|进账|报销|退款|退了|入账/.test(text) ? ("in" as const) : ("out" as const),
          amountCents: amount,
          category: /随|礼|满月|红包/.test(text)
            ? "人情往来"
            : /超市|买菜|购物/.test(text)
              ? "购物"
              : "餐饮",
          counterparty: people[0]?.name,
          confidence: 0.8,
        }
      : { hasAmount: false, confidence: 0.7 },
    mood: mood ? { label: mood.label, score: mood.score, confidence: 0.7 } : { label: null, score: null, confidence: 0.6 },
    diet: {
      applicable: dietHit,
      meal: /夜宵|宵夜/.test(text) ? "夜宵" : /加餐|下午茶/.test(text) ? "加餐" : /早/.test(text) ? "早餐" : /午饭|中午/.test(text) ? "午餐" : /晚/.test(text) ? "晚餐" : "未知",
      items: dietHit ? [{ name: text.slice(0, 12), amount: null, kcal: null }] : [],
      totalKcal: null,
      confidence: dietHit ? 0.6 : 0.5,
    },
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
    try {
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
        ext = ruleExtract(text);
        confidence = 0.5;
      }
    } catch (e) {
      // LLM 调用失败（限流/超时/断网/输出无 JSON）：规则兜底，打卡入口永不因此失败
      console.warn("[ai] LLM 调用失败，规则兜底：", String(e).slice(0, 200));
      ext = ruleExtract(text);
      confidence = 0.4;
    }
  } else {
    ext = ruleExtract(text);
    confidence = 0.5;
  }

  // 时长：LLM 抽取优先，回退到话术再解析，最后类别默认
  const defaults = { sleep: 480, fitness: 60, social: 60, chores: 60, work: 60, study: 60, fun: 30, commute: 30, other: 30, ...opts.defaults };
  const durationFromText = parseDuration(text);
  const durationMin = ext.schedule.durationMin ?? durationFromText ?? defaults[ext.schedule.activity];
  // 防御：过滤模型输出的占位人名（"省略"/"无"/空）
  const people = ext.people.filter((p) => p.name && !/^(省略|无|没有|null|none)$/i.test(p.name.trim()));

  // 意图派生：todo（未来话术）> schedule（日程域命中）> status（纯动态）
  const future = ext.todo.applicable || detectFuture(text) !== null;
  const scheduleApplicable = !future && ext.schedule.applicable;
  const intent: ParseResultT["intent"] = future ? "todo" : scheduleApplicable ? "schedule" : "status";

  // 未来话术 → 不钳制的计划时刻（上层创建 TODO）；过去/当前 → 照常推断并钳制；status → 时间无意义，仅留档
  const tb = inferTimeBlock(text, now, durationMin, ext.schedule.periodHint ?? undefined, future);

  // 心情：LLM 词优先；score 缺失时按规则基准分补全
  const moodLabel = (ext.mood.label ?? "").trim() || null;
  const moodScore = moodLabel ? (ext.mood.score ?? ruleMood(moodLabel)?.score ?? 0) : null;

  // 饮食归一：过滤空名条目；totalKcal 缺失时按已知项合计
  const dietItems = ext.diet.items.filter((it) => it.name?.trim());
  const knownKcal = dietItems.reduce((s, it) => s + (it.kcal ?? 0), 0);
  const totalKcal = ext.diet.totalKcal ?? (knownKcal > 0 ? knownKcal : null);

  return ParseResult.parse({
    activity: ext.schedule.activity,
    title: ext.schedule.title?.trim() || makeTitle(text),
    time: {
      mode: tb.mode,
      start: tb.start.toISOString(),
      end: tb.end.toISOString(),
      durationMin: tb.durationMin,
      confidence,
    },
    intent,
    scheduleApplicable,
    scheduleConfidence: ext.schedule.confidence,
    todoConfidence: ext.todo.confidence,
    financeConfidence: ext.finance.confidence ?? 0.8,
    mood: {
      label: moodLabel,
      score: moodScore,
      confidence: ext.mood.confidence ?? 0.8,
    },
    diet: {
      applicable: ext.diet.applicable && dietItems.length > 0,
      meal: ext.diet.meal,
      items: dietItems,
      totalKcal,
      confidence: ext.diet.confidence,
    },
    finance: {
      hasAmount: ext.finance.hasAmount,
      // 方向以模型给的 direction 为准；缺失时默认支出（随口记账多为花销），金额恒为正
      direction: ext.finance.direction ?? "out",
      amountCents: Math.abs(ext.finance.amountCents ?? 0) || null,
      category: ext.finance.category ?? null,
      counterparty: ext.finance.counterparty ?? null,
    },
    people,
    ambiguity: ext.ambiguity ?? null,
    engine: useLlm ? "llm" : "rules",
  });
}
