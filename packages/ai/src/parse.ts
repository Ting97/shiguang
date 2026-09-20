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
import { inferTimeBlock, detectPeriod, detectFuture, parseClockRange, resolveExplicitRange, resolveMoment } from "./time-infer";
import { parseAmountCents, parseDuration } from "./duration";
import { ruleMood } from "./mood-rules";

export interface ParseOptions {
  now?: Date;
  /** 类别默认时长表（activityId → 分钟）；缺省 30 */
  defaults?: Partial<Record<(typeof ACTIVITY_IDS)[number], number>>;
  /** 强制使用规则引擎（测试用） */
  forceRules?: boolean;
  /** LLM 成功响应后回调 token 用量（审计/成本核算用） */
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number }) => void;
}

// ---------- 规则引擎（dry-run） ----------

const RULE_KEYWORDS: Array<[RegExp, LlmExtractionT["schedule"]["activity"]]> = [
  [/午睡|睡觉|补觉/, "sleep"],
  [/通勤|路上|地铁|公交|打车/, "commute"],
  [/开[了了个]*会|评审|周报|报告|代码|开发|编程|邮件|客户|上班|加班|项目/, "work"],
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

/** GLM 提示词用北京时间墙钟：toISOString 是 UTC，北京 00:00–08:00 间的记录会让模型把"今天"算成前一天 */
function toCstWallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const c = new Date(d.getTime() + 8 * 3600_000);
  return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())} ${p(c.getHours())}:${p(c.getMinutes())}（北京时间）`;
}

/** 从原话确定性恢复饮食条目（GLM 整句当 name 时的兜底）："今天喝了两杯黑咖啡两杯豆浆和一点点香芋条" → 黑咖啡/豆浆/香芋条 */
export function recoverDietItemsFromText(text: string): { name: string; amount: string | null; kcal: number | null }[] | null {
  let t = text.trim()
    .replace(/^(今天|今日|刚才|刚刚|现在|早上|中午|晚上)/, "")
    .replace(/^(喝了|吃了|喝|吃|点了|点了)/, "")
    .replace(/^(了)/, "");
  if (t === text) return null; // 没去掉任何时间/动词前缀 → 不像饮食流水账，放弃恢复
  const items: { name: string; amount: string | null; kcal: number | null }[] = [];
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
          user: buildExtractUserPrompt(text, toCstWallClock(now)),
        onUsage: opts.onUsage,
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
  // 已发生/未来的判定以 AI 为主（prompt 已给当前时间与判定反例）；detectFuture 收紧后只兜显式未来词
  // （明天/待会儿），裸词"准备/计划"不再一票否决 AI 的补记判定
  const future = ext.todo.applicable || detectFuture(text) !== null;

  // 未来话术 → 不钳制的计划时刻（上层创建 TODO）；过去/当前 → 照常推断并钳制；status → 时间无意义，仅留档
  // AI 直推起止优先（最强显式信号）；缺失/非法回退规则引擎推断
  const glmRange = resolveExplicitRange(ext.schedule.start ?? null, ext.schedule.end ?? null, now);
  const todoDue = resolveMoment(ext.todo.due ?? null, now);
  let tb = glmRange
    ? {
        mode: "explicit" as const,
        start: glmRange.start,
        end: glmRange.end,
        durationMin: Math.round((glmRange.end.getTime() - glmRange.start.getTime()) / 60_000),
      }
    : inferTimeBlock(text, now, durationMin, ext.schedule.periodHint ?? undefined, future);
  if (future && todoDue) {
    tb = { mode: "future", start: todoDue, end: todoDue, durationMin };
  }
  // 进行中：起止区间横跨当下（已开始未结束）→ 落日程块之外再生成收尾待办
  // （explicit/relative 都可能是显式钟点区间的产物——"9:10到9:30"无时长词时 mode=relative）
  const ongoing = !future && (tb.mode === "explicit" || tb.mode === "relative") && tb.start <= now && now < tb.end;
  // 显式起止区间本身就是"具体的事"的最强信号（如"工作准备"无活动词也不该判成纯感想）
  // 弱锚点防御：无显式钟点/时段/时长/未来信号/刚…标记时，日程锚只能落到默认回顾点或当下——
  // 这类多为饮食/感受类流水账（GLM 偶发误判 applicable），强制降级为纯动态
  const hasExplicitTime =
    glmRange !== null ||
    parseClockRange(text, ext.schedule.periodHint ?? null) !== null ||
    /\d{1,2}\s*[点时]/.test(text) ||
    detectPeriod(text) !== null ||
    detectFuture(text) !== null ||
    parseDuration(text) !== null ||
    /刚(刚)?|完(了|成)/.test(text);
  const scheduleApplicable = !future && (ext.schedule.applicable || ongoing) && hasExplicitTime;
  const intent: ParseResultT["intent"] = future ? "todo" : scheduleApplicable ? "schedule" : "status";

  // 心情：LLM 词优先；score 缺失时按规则基准分补全
  const moodLabel = (ext.mood.label ?? "").trim() || null;
  const moodScore = moodLabel ? (ext.mood.score ?? ruleMood(moodLabel)?.score ?? 0) : null;

  // 饮食归一：过滤空名条目；totalKcal 缺失时按已知项合计
  // 饮食名过滤：整句/句子片段被误当食物名时丢弃（如"今天喝了两杯黑咖啡两杯豆"）
  let dietItems = ext.diet.items.filter(
    (it) => it.name?.trim() && !/^(今天|今日|刚才|刚刚|我|现在)/.test(it.name.trim()) && it.name.trim().length <= 16,
  );
  // GLM 拆分失败（整句当条目被滤空）→ 从原话确定性恢复：去时间词/动词 → 按连词拆分 → 去数量词
  if (dietItems.length === 0 && ext.diet.applicable) {
    const recovered = recoverDietItemsFromText(text);
    if (recovered) dietItems = recovered;
  }
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
    ongoing,
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
