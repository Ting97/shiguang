/**
 * 解析管线：一句话 → 多域结构化结果
 * 双引擎：LLM（有 API Key）+ 规则引擎（dry-run 兜底/离线/单测）
 */
import { chat, extractJson, hasApiKey } from "./client.js";
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt } from "./prompt.js";
import {
  LlmExtraction, ParseResult, ACTIVITY_IDS,
  type LlmExtraction as LlmExtractionT, type ParseResult as ParseResultT,
} from "./schema.js";
import { inferTimeBlock, detectPeriod } from "./time-infer.js";
import { parseAmountCents } from "./duration.js";

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
  [/打扫|买菜|超市|做饭|洗衣|房间/, "chores"],
  [/吃饭|聊|电话|爸妈|老王|小李|朋友|同事|随礼|满月|搬家|帮忙/, "social"],
];

const PEOPLE_RE = [/老王/g, /爸妈/g, /小李/g, /朋友/g, /同事(?:小李)?/g];

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
    activity,
    title: text.slice(0, 8),
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
      ext = ruleExtract(text); // LLM 输出不合格 → 规则兜底
      confidence = 0.5;
    }
  } else {
    ext = ruleExtract(text);
    confidence = 0.5;
  }

  // 时长：LLM 抽取优先，回退到话术再解析，最后类别默认
  const defaults = { sleep: 480, fitness: 60, social: 60, chores: 60, work: 60, study: 60, fun: 30, commute: 30, other: 30, ...opts.defaults };
  const { parseDuration } = await import("./duration.js");
  const durationFromText = parseDuration(text);
  const durationMin = ext.durationMin ?? durationFromText ?? defaults[ext.activity];

  const tb = inferTimeBlock(text, now, durationMin, ext.periodHint);

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
    finance: ext.finance,
    people: ext.people,
    ambiguity: ext.ambiguity ?? null,
    engine: useLlm ? "llm" : "rules",
  });
}
