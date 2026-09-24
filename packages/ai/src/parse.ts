/**
 * 解析管线 v2：AI 完全自主识别，规则引擎降级为灾难兜底
 *
 * 双模式：
 * - 全量（发动态/编辑）：一次 GLM 调用五域联合（FullExtractionV2）
 * - 单域（识别菜单重识别）：该域专属提示词（DOMAIN_PROMPTS + domainExtractionV2），只出本域
 *
 * 规则引擎仅在四类灾难场景接管：无 Key / chat 抛错（含额度熔断）/ 重问后仍 schema 不合格 / forceRules（测试）。
 * 成功路径不做任何规则语义干预——仅保留确定性后处理（时间合法性校验、区间→时长换算、ongoing 推导、kcal 求和）。
 */
import { chat, extractJson, hasApiKey, isQuotaTripped, GlmError } from "./glm";
import { EXTRACT_SYSTEM_PROMPT, DOMAIN_PROMPTS, OPEN_VOCAB_SYSTEM_PROMPT, buildExtractUserPrompt, buildRepairUserPrompt, buildOpenVocabUserPrompt } from "./prompt";
import {
  ParseResult, FullExtractionV2, OpenVocabExtraction, domainExtractionV2, ACTIVITY_IDS,
  type LlmExtraction as LlmExtractionT, type ParseResult as ParseResultT, type OpenVocabExtractionT,
} from "./schema";
import { jevAsk, jevEnabled, JevError } from "./jev";
import { extractClosedSetQuestions } from "./questions/jev-sets";
import { inferTimeBlock, detectPeriod, detectFuture, parseClockRange, resolveExplicitRange, resolveMoment, anchorRangeToToday, anchorMomentToToday } from "./time-infer";
import { parseAmountCents, parseDuration } from "./duration";
import { ruleMood } from "./mood-rules";

export interface ParseOptions {
  now?: Date;
  /** 类别默认时长表（activityId → 分钟）；仅规则兜底路径使用 */
  defaults?: Partial<Record<(typeof ACTIVITY_IDS)[number], number>>;
  /** 强制使用规则引擎（测试用） */
  forceRules?: boolean;
  /** 单域模式：只识别该域（schedule/todo/finance/mood/diet/people） */
  domain?: string;
  /** 用户已有联系人名单（人物识别时对齐称呼，避免重复建档） */
  contactNames?: string[];
  /** 覆盖 system prompt（DB 纳管值注入；缺省用包内默认）。仅影响 LLM 路径，规则兜底不受影响 */
  systemPrompt?: string;
  /** 覆盖完整 user prompt（REQ-003 3-A：apps/api 按 DB 配置装配后传入；缺省用包内默认装配）。仅影响 LLM 路径 */
  userPrompt?: string;
  /** LLM 成功响应后回调 token 用量（审计/成本核算用） */
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number }) => void;
}

/** 单域识别的合法域 */
const DOMAIN_MODES = ["schedule", "todo", "finance", "mood", "diet", "people"] as const;

// ---------- 规则引擎（灾难兜底，原样保留） ----------

const RULE_KEYWORDS: Array<[RegExp, LlmExtractionT["schedule"]["activity"]]> = [
  [/午睡|睡觉|补觉/, "sleep"],
  [/通勤|路上|地铁|公交|打车/, "commute"],
  [/开[了了个]*会|评审|周报|报告|代码|开发|编程|邮件|客户|上班|加班|项目/, "work"],
  [/学|看书|阅读|读书|英语|上课|刷题|三章/, "study"],
  [/跑|撸铁|健身|锻炼|球类|散步|拉伸/, "fitness"],
  [/抖音|电影|游戏|刷手机|逛街/, "fun"],
  [/打扫|买菜|超市|做饭|洗衣|房间|垃圾/, "chores"],
  // 人名不进关键词表（人物识别由联系人名单驱动，FR-D2.3）；爸妈为通用亲属称谓非演示人名
  [/吃饭|聊|电话|爸妈|朋友|同事|随礼|满月|搬家|帮忙/, "social"],
];

/** 规则人物识别（FR-D2.3）：演示人名已移除——由调用方传入的联系人名单动态生成；空名单不产人物 */
function peopleRegexFrom(names: string[] | undefined): RegExp[] {
  if (!names || names.length === 0) return [];
  return names.slice(0, 100).map((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
}

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

function ruleExtract(text: string, contactNames?: string[]): LlmExtractionT {
  let activity: LlmExtractionT["schedule"]["activity"] = "other";
  for (const [re, act] of RULE_KEYWORDS) {
    if (re.test(text)) { activity = act; break; }
  }
  const amount = parseAmountCents(text);
  // 人物去重："同事小陈"与"小陈"同时命中时保留更短的称呼
  const rawNames = peopleRegexFrom(contactNames).map((re) => [...text.matchAll(re)].map((m) => m[0])).flat();
  // 人物去重："同事小陈"与"小陈"同时命中时保留更短称呼——联系人名单里是"小陈"，
  // 保留长串会让 people 落库成带前缀的称呼对不上名单（旧版行为与注释相反，实际保留了长串）
  const people = [...new Set(rawNames)]
    .filter((n) => !rawNames.some((m) => m !== n && n.includes(m)))
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
          category: /随(礼|份子)|礼金|份子|红包/.test(text)
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

/** GLM 提示词用北京时间墙钟：+8h 后必须读 UTC getter（getHours 等读宿主机时区，CST 机器上会二次 +8） */
export function toCstWallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const c = new Date(d.getTime() + 8 * 3600_000);
  return `${c.getUTCFullYear()}-${p(c.getUTCMonth() + 1)}-${p(c.getUTCDate())} ${p(c.getUTCHours())}:${p(c.getUTCMinutes())}（北京时间）`;
}

/** 从原话确定性恢复饮食条目（规则路径整句当 name 时的兜底）：已不再用于 AI 路径（v2 schema 直接校验拒绝） */
export function recoverDietItemsFromText(text: string): { name: string | null; amount: string | null; kcal: number | null }[] | null {
  const t = text.trim()
    .replace(/^(今天|今日|刚才|刚刚|现在|早上|中午|晚上)/, "")
    .replace(/^(喝了|吃了|喝|吃|点了|点了)/, "")
    .replace(/^(了)/, "");
  if (t === text) return null; // 没去掉任何时间/动词前缀 → 不像饮食流水账，放弃恢复
  const items: { name: string | null; amount: string | null; kcal: number | null }[] = [];
  for (const rawPart of t.split(/和|及|还有|，|,|、/)) {
    const seg = rawPart.trim().replace(/^一点点/, "").replace(/([0-9一二两三四五六七八九十半]+)(杯|碗|瓶|罐|份|个|根|块|片|包|盒|盘|颗)/g, "、");
    for (const piece of seg.split("、")) {
      const name = piece.replace(/^[杯碗瓶罐份个根条块片包盒盘颗]/, "").trim();
      if (name.length >= 2 && name.length <= 12 && !/[了的在]/.test(name)) {
        items.push({ name, amount: null, kcal: null });
      }
    }
  }
  return items.length >= 1 ? items : null;
}

// ---------- AI 路径（v2 主干） ----------

/** AI 调用与校验：失败时抛错（由 parseInput 决定降级）；输出不合格自动带错误清单重问一次 */
export async function aiExtract(
  text: string,
  domain: string | undefined,
  now: Date,
  onUsage?: ParseOptions["onUsage"],
  contactNames?: string[],
  systemOverride?: string,
  userOverride?: string,
): Promise<{ ext: LlmExtractionT; engine: "llm" | "llm-repaired" }> {
  const system = systemOverride ?? (domain ? DOMAIN_PROMPTS[domain] : EXTRACT_SYSTEM_PROMPT);
  const schema = domain ? domainExtractionV2(domain) : FullExtractionV2;
  // user prompt 覆盖优先（3-A 输入装配）；缺省用包内默认装配
  const base = userOverride ?? buildExtractUserPrompt(text, toCstWallClock(now), contactNames);

  let raw = await chat({ system, user: base, onUsage });
  let parsed = schema.safeParse(extractJson(raw));
  if (!parsed.success) {
    // 一次自修复重问：把校验错误清单反馈给模型（仅畸形输出多花一次调用）
    const issues = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    console.warn(`[ai] 输出未通过校验，重问：${issues.join("；").slice(0, 200)}`);
    raw = await chat({ system, user: buildRepairUserPrompt(base, raw, issues), onUsage });
    parsed = schema.safeParse(extractJson(raw));
    if (!parsed.success) {
      throw new GlmError("badOutput", `重问后仍不合格：${parsed.error.issues.slice(0, 3).map((i) => i.message).join("；")}`);
    }
    return { ext: assembleExtraction(parsed.data, domain), engine: "llm-repaired" };
  }
  return { ext: assembleExtraction(parsed.data, domain), engine: "llm" };
}

// ---------- Jev 混合引擎（REQ-003 3-D：Jev 闭集 + GLM 开放词汇瘦身提取） ----------

/** 混合引擎不可用（Jev 未启用/调用失败、或瘦身提取失败）——调用方降级全量 GLM */
export class HybridUnavailableError extends Error {
  constructor(public reason: string) {
    super(`[hybrid] ${reason}`);
    this.name = "HybridUnavailableError";
  }
}

export interface HybridParseOptions extends ParseOptions {
  /** 瘦身开放词汇提取的 system/user prompt（apps/api 按 DB 配置装配传入；缺省用包内默认） */
  slimSystemPrompt?: string;
  slimUserPrompt?: string;
}

/** GLM 瘦身提取：只出开放词汇字段（校验不过自动带错误清单重问一次，与 aiExtract 同策略） */
async function openVocabExtract(text: string, now: Date, opts: HybridParseOptions): Promise<OpenVocabExtractionT> {
  const system = opts.slimSystemPrompt ?? OPEN_VOCAB_SYSTEM_PROMPT;
  const base = opts.slimUserPrompt ?? buildOpenVocabUserPrompt(text, toCstWallClock(now), opts.contactNames);
  let raw = await chat({ system, user: base, onUsage: opts.onUsage });
  let parsed = OpenVocabExtraction.safeParse(extractJson(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    console.warn(`[hybrid] 瘦身输出未通过校验，重问：${issues.join("；").slice(0, 200)}`);
    raw = await chat({ system, user: buildRepairUserPrompt(base, raw, issues), onUsage: opts.onUsage });
    parsed = OpenVocabExtraction.safeParse(extractJson(raw));
    if (!parsed.success) {
      throw new GlmError("badOutput", `瘦身重问后仍不合格：${parsed.error.issues.slice(0, 3).map((i) => i.message).join("；")}`);
    }
  }
  return parsed.data;
}

/** noul 答案 → 布尔 + 校准概率（概率存在时原样透传；缺失/undefined 时给 missingP，未指定按布尔给保守值） */
function noulOf(jev: Awaited<ReturnType<typeof jevAsk>>, key: string, missingP?: number): { v: boolean; p: number } {
  const a = jev.answers[key];
  const v = a?.value === true;
  const p = a?.probabilities && typeof a.probabilities.true === "number"
    ? a.probabilities.true
    : missingP ?? (v ? 0.9 : 0.5);
  return { v, p };
}

/**
 * 混合解析（3-D 接管路径）：Jev 一次并行回答闭集 12 问，GLM 瘦身提取只出开放词汇，合并层拼装后走与全量
 * GLM 完全相同的确定性后处理（mapAiResult）。Jev 未启用/调用失败、或瘦身提取失败 → 抛 HybridUnavailableError，
 * 由调用方降级全量 GLM（rules 兜底仍在 parseInput 内）。
 */
export async function parseHybridInput(text: string, opts: HybridParseOptions = {}): Promise<ParseResultT> {
  // 拷贝后再清秒：原地 setSeconds 会突变调用方传入的 opts.now（埋雷）
  const now = new Date((opts.now ?? new Date()).getTime());
  now.setSeconds(0, 0);
  if (opts.forceRules) throw new HybridUnavailableError("force-rules");
  if (!hasApiKey() || isQuotaTripped()) throw new HybridUnavailableError("glm-unavailable");
  if (!jevEnabled()) throw new HybridUnavailableError("jev-not-enabled");

  // 1) Jev 闭集（一次并行；网络/超时/鉴权失败即整体不可用）
  let jev: Awaited<ReturnType<typeof jevAsk>>;
  try {
    const state = `用户随口记录了一句话（当前时间：${toCstWallClock(now)}）：\n「${text}」`;
    jev = await jevAsk(state, extractClosedSetQuestions());
  } catch (e) {
    throw new HybridUnavailableError(e instanceof JevError ? e.kind : String(e).slice(0, 120));
  }

  // 2) GLM 瘦身开放词汇
  let g: OpenVocabExtractionT;
  try {
    g = await openVocabExtract(text, now, opts);
  } catch (e) {
    throw new HybridUnavailableError(`open-vocab: ${e instanceof GlmError ? e.kind : String(e).slice(0, 100)}`);
  }

  // 3) 合并：闭集信 Jev，开放字段信 GLM
  const sched = noulOf(jev, "sched_applicable");
  const todo = noulOf(jev, "todo_applicable");
  const fin = noulOf(jev, "fin_applicable");
  const moodA = noulOf(jev, "mood_applicable", 0.6);
  const dietA = noulOf(jev, "diet_applicable");
  const peopleA = noulOf(jev, "people_applicable");
  const recordFuture = jev.answers["record_type"]?.value === "future";
  const activityRaw = jev.answers["activity"]?.value;
  const activity = (ACTIVITY_IDS as readonly string[]).includes(activityRaw as string)
    ? (activityRaw as LlmExtractionT["schedule"]["activity"])
    : "other";
  const dirRaw = jev.answers["fin_direction"]?.value;
  const mealRaw = jev.answers["diet_meal"]?.value;
  const meal = (["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"] as readonly string[]).includes(mealRaw as string)
    ? (mealRaw as LlmExtractionT["diet"]["meal"])
    : "未知";
  const periodRaw = jev.answers["period"]?.value;
  const periodHint = (["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"] as readonly string[]).includes(periodRaw as string)
    ? (periodRaw as LlmExtractionT["schedule"]["periodHint"])
    : null;

  const scheduleApplicableHybrid = sched.v && !recordFuture;

  const ext: LlmExtractionT = {
    reasoning: {},
    schedule: {
      applicable: scheduleApplicableHybrid,
      activity,
      // applicable 但 GLM 未抽出标题 → 从原话兜底（v2 同语义：空标题日程不得入库）；超 30 字截断（ParseResult 契约）
      title: scheduleApplicableHybrid && !(g.title ?? "").trim() ? makeTitle(text) : (g.title ?? "").slice(0, 30),
      durationMin: g.durationMin ?? null,
      // 瘦身模型给出的起止（ISO）；mapAiResult 的确定性校验兜住不合法区间（域降级）
      start: g.start ?? null,
      end: g.end ?? null,
      periodHint,
      confidence: sched.p,
    },
    todo: { applicable: todo.v || recordFuture, due: g.due ?? null, confidence: Math.max(todo.p, recordFuture ? 0.9 : 0) },
    finance: {
      // 有金额判定信 Jev；但金额数只能来自 GLM——闭集说有而开放字段没抽出金额时按无金额处理（宁漏勿错）
      hasAmount: fin.v && g.amountCents != null,
      direction: dirRaw === "income" ? "in" : "out",
      amountCents: g.amountCents ?? null,
      category: fin.v ? (jev.answers["fin_category"]?.value as string | null) ?? "其他" : null,
      counterparty: g.counterparty ?? null,
      confidence: fin.p,
    },
    mood: {
      label: moodA.v ? g.mood?.label ?? null : null,
      score: moodA.v ? g.mood?.score ?? null : null,
      // 概率存在时原样透传，不抬轿（Math.max 低概率强抬过 0.6 阈值会让该域跳过待确认）；仅缺失时回落 0.6
      confidence: moodA.p,
    },
    diet: {
      applicable: dietA.v,
      meal,
      items: dietA.v ? g.dietItems ?? [] : [],
      totalKcal: null,
      confidence: dietA.p,
    },
    people: peopleA.v ? g.people ?? [] : [],
    ambiguity: null,
  };
  return mapAiResult(ext, text, now, "jev-hybrid");
}

/** 把全量/单域的 v2 校验结果拼装回统一 Extraction 形状（单域模式其余域为中性"不适用"） */function assembleExtraction(data: unknown, domain: string | undefined): LlmExtractionT {
  const d = data as Record<string, unknown>;
  const neutralSchedule = { applicable: false, activity: "other" as const, title: "", durationMin: null, periodHint: null, confidence: 0.9 };
  const neutralTodo = { applicable: false, due: null, confidence: 0.9 };
  const neutralFinance = { hasAmount: false, direction: null, amountCents: null, category: null, counterparty: null, confidence: 0.9 };
  const neutralMood = { label: null, score: null, confidence: 0.9 };
  const neutralDiet = { applicable: false, meal: "未知" as const, items: [], totalKcal: null, confidence: 0.9 };
  if (!domain) return data as unknown as LlmExtractionT; // 全量：v2 已严格校验，直接装配（不再过旧宽松 schema——会误抛）
  return {
    reasoning: {},
    schedule: domain === "schedule" ? (d.schedule as LlmExtractionT["schedule"]) : neutralSchedule,
    todo: domain === "todo" ? (d.todo as LlmExtractionT["todo"]) : neutralTodo,
    finance: domain === "finance" ? (d.finance as LlmExtractionT["finance"]) : neutralFinance,
    mood: domain === "mood" ? (d.mood as LlmExtractionT["mood"]) : neutralMood,
    diet: domain === "diet" ? (d.diet as LlmExtractionT["diet"]) : neutralDiet,
    people: domain === "people" ? ((d.people ?? []) as LlmExtractionT["people"]) : [],
    ambiguity: null,
  };
}

/** AI 结果 → ParseResult：确定性后处理（校验/换算），无规则语义 */
function mapAiResult(ext: LlmExtractionT, text: string, now: Date, engine: "llm" | "llm-repaired" | "jev-hybrid"): ParseResultT {
  const future = ext.todo.applicable; // AI 判定即最终判定
  // 日期锚定：话术无日期词时模型偶发把当天区间挪到明天（17:22 说"下午2点到6点"→次日），
  // 按用户规则「没写哪一天都按当天算」整天平移回今天（凌晨补记昨天除外）
  const rangeRaw = resolveExplicitRange(ext.schedule.start ?? null, ext.schedule.end ?? null, now);
  const range = rangeRaw ? anchorRangeToToday(rangeRaw, text, now) : null;
  if (rangeRaw && range && rangeRaw.start.getTime() !== range.start.getTime()) {
    console.warn(`[ai] 区间日期锚定：${rangeRaw.start.toISOString()} → ${range.start.toISOString()}（话术无日期词）`);
  }
  const dueRaw = resolveMoment(ext.todo.due ?? null, now);
  const due = dueRaw ? anchorMomentToToday(dueRaw, text, now) : null;

  // 日程时刻：AI 区间为准；applicable 但区间不合法（超幅等，schema 已保证可解析）→ 该域降级为不适用并留痕
  let scheduleApplicable = !future && ext.schedule.applicable;
  if (scheduleApplicable && !range) {
    console.warn("[ai] schedule.applicable 但起止不合法，域降级：", ext.schedule.start, ext.schedule.end);
    scheduleApplicable = false;
  }
  const intent: ParseResultT["intent"] = future ? "todo" : scheduleApplicable ? "schedule" : "status";

  // 时间块（中性占位：非日程非待办时仅留档）
  let tb: { mode: "explicit" | "future" | "default"; start: Date; end: Date; durationMin: number };
  if (future && due) {
    tb = { mode: "future", start: due, end: due, durationMin: ext.schedule.durationMin ?? 30 };
  } else if (range) {
    tb = {
      mode: "explicit",
      start: range.start,
      end: range.end,
      durationMin: ext.schedule.durationMin ?? Math.round((range.end.getTime() - range.start.getTime()) / 60_000),
    };
  } else {
    tb = { mode: "default", start: new Date(now.getTime() - 30 * 60_000), end: now, durationMin: 30 };
  }
  // 进行中：AI 区间横跨当下（已开始未结束）→ 落日程块之外再生成收尾待办
  const ongoing = !future && scheduleApplicable && tb.mode === "explicit" && tb.start <= now && now < tb.end;

  const dietItems = ext.diet.items.filter((it) => it.name?.trim());
  const knownKcal = dietItems.reduce((s, it) => s + (it.kcal ?? 0), 0);
  const moodLabel = (ext.mood.label ?? "").trim() || null;

  return ParseResult.parse({
    activity: ext.schedule.activity,
    title: ext.schedule.title?.trim().slice(0, 30), // 上游瘦身契约允许 40 字，超 30 会让 zod 抛错且无法降级 → 此处截断
    time: {
      mode: tb.mode,
      start: tb.start.toISOString(),
      end: tb.end.toISOString(),
      durationMin: Math.max(1, tb.durationMin),
      confidence: engine === "llm" ? 0.9 : 0.85,
    },
    intent,
    ongoing,
    scheduleApplicable,
    scheduleConfidence: ext.schedule.confidence,
    todoConfidence: ext.todo.confidence,
    financeConfidence: ext.finance.confidence,
    mood: { label: moodLabel, score: ext.mood.score ?? null, confidence: ext.mood.confidence },
    diet: {
      applicable: ext.diet.applicable && dietItems.length > 0,
      meal: ext.diet.meal,
      items: dietItems,
      totalKcal: ext.diet.totalKcal ?? (knownKcal > 0 ? knownKcal : null),
      confidence: ext.diet.confidence,
    },
    finance: {
      hasAmount: ext.finance.hasAmount,
      // 输出层形状归一：无金额时方向落 "out"（v2 允许 AI 给 null；语义仍以 hasAmount 为准）
      direction: ext.finance.direction ?? "out",
      amountCents: ext.finance.amountCents != null ? Math.abs(ext.finance.amountCents) : null,
      category: ext.finance.category ?? null,
      counterparty: ext.finance.counterparty ?? null,
    },
    people: ext.people,
    ambiguity: ext.ambiguity ?? null,
    engine,
    fallbackReason: null,
  });
}

// ---------- 规则路径（原 v1 管线，灾难兜底时使用） ----------

function rulesPipeline(
  text: string,
  now: Date,
  opts: ParseOptions,
  fallbackReason: string,
): ParseResultT {
  const ext = ruleExtract(text, opts.contactNames);
  const defaults = { sleep: 480, fitness: 60, social: 60, chores: 60, work: 60, study: 60, fun: 30, commute: 30, other: 30, ...opts.defaults };
  const durationFromText = parseDuration(text);
  const durationMin = ext.schedule.durationMin ?? durationFromText ?? defaults[ext.schedule.activity];
  const people = ext.people.filter((p) => p.name && !/^(省略|无|没有|null|none)$/i.test(p.name.trim()));
  const future = ext.todo.applicable || detectFuture(text) !== null;
  const tb = inferTimeBlock(text, now, durationMin, ext.schedule.periodHint ?? undefined, future);
  const ongoing = !future && (tb.mode === "explicit" || tb.mode === "relative") && tb.start <= now && now < tb.end;
  // v1 同款弱锚点防御：无显式时间信号的 applicable 多为误报（饮食/感想），否决；
  // 显式区间横跨当下（ongoing）是最强"具体的事"信号，救回
  const hasExplicitTime =
    parseClockRange(text, ext.schedule.periodHint ?? null) !== null ||
    /\d{1,2}\s*[点时]/.test(text) ||
    detectPeriod(text) !== null ||
    detectFuture(text) !== null ||
    parseDuration(text) !== null ||
    /刚(刚)?|完(了|成)/.test(text);
  const scheduleApplicable = !future && (ext.schedule.applicable || ongoing) && hasExplicitTime;
  const intent: ParseResultT["intent"] = future ? "todo" : scheduleApplicable ? "schedule" : "status";
  const moodLabel = (ext.mood.label ?? "").trim() || null;
  const moodScore = moodLabel ? (ext.mood.score ?? ruleMood(moodLabel)?.score ?? 0) : null;
  const dietItems = ext.diet.items.filter((it) => it.name?.trim());

  return ParseResult.parse({
    activity: ext.schedule.activity,
    title: ext.schedule.title?.trim().slice(0, 30) || makeTitle(text),
    time: {
      mode: tb.mode,
      start: tb.start.toISOString(),
      end: tb.end.toISOString(),
      durationMin: tb.durationMin,
      confidence: 0.4,
    },
    intent,
    ongoing,
    scheduleApplicable,
    scheduleConfidence: ext.schedule.confidence,
    todoConfidence: ext.todo.confidence,
    financeConfidence: ext.finance.confidence ?? 0.8,
    mood: { label: moodLabel, score: moodScore, confidence: ext.mood.confidence ?? 0.7 },
    diet: {
      applicable: ext.diet.applicable && dietItems.length > 0,
      meal: ext.diet.meal,
      items: dietItems,
      totalKcal: ext.diet.totalKcal ?? null,
      confidence: ext.diet.confidence,
    },
    finance: {
      hasAmount: ext.finance.hasAmount,
      direction: ext.finance.direction ?? "out",
      amountCents: ext.finance.amountCents != null ? Math.abs(ext.finance.amountCents) : null,
      category: ext.finance.category ?? null,
      counterparty: ext.finance.counterparty ?? null,
    },
    people,
    ambiguity: ext.ambiguity ?? null,
    engine: "rules",
    fallbackReason,
  });
}

// ---------- 主入口 ----------

export async function parseInput(text: string, opts: ParseOptions = {}): Promise<ParseResultT> {
  // 拷贝后再清秒：原地 setSeconds 会突变调用方传入的 opts.now（埋雷）
  const now = new Date((opts.now ?? new Date()).getTime());
  now.setSeconds(0, 0); // 时间对齐到整分钟：时间轴记录到分即可
  const domain = opts.domain && (DOMAIN_MODES as readonly string[]).includes(opts.domain) ? opts.domain : undefined;

  const canLlm = !opts.forceRules && hasApiKey() && !isQuotaTripped();
  if (!canLlm) {
    const reason = opts.forceRules
      ? "force-rules"
      : isQuotaTripped()
        ? "quota-breaker（额度熔断中）"
        : "no-api-key";
    return rulesPipeline(text, now, opts, reason);
  }

  try {
    const { ext, engine } = await aiExtract(text, domain, now, opts.onUsage, opts.contactNames, opts.systemPrompt, opts.userPrompt);
    return mapAiResult(ext, text, now, engine);
  } catch (e) {
    // 灾难降级：GLM 不可用（网络/超时/额度/鉴权）或重问后输出仍不合格 → 规则引擎接管，打卡入口永不失败
    const reason = e instanceof GlmError ? e.kind : String(e).slice(0, 120);
    console.warn(`[ai] LLM 失败（${reason}），规则兜底：`, String(e).slice(0, 200));
    return rulesPipeline(text, now, opts, reason);
  }
}
