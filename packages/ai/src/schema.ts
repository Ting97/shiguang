/**
 * 解析结果 Schema —— 一句话输入的五域独立结构化输出
 * 对应 docs/06 §3.1 + §8（五域识别改造，2026-09-18）
 * 设计：每个域独立判定 applicable（识别不出不强制）；每域带 confidence（<0.6 上层转 pending 待确认）
 */
import { z } from "zod";

/** 八大活动分类（id 与 packages/db/schema.sql 的 activities 对应） */
export const ACTIVITY_IDS = [
  "sleep", "work", "study", "fitness",
  "social", "fun", "chores", "commute", "other",
] as const;

export const ActivityId = z.enum(ACTIVITY_IDS);

/**
 * 识别结果 activity 取值：预设枚举 id 或用户自定义分类（id/名称原样透传）。
 * 硬枚举会拒掉用户自定义分类——这里只做形状校验，归一由服务端 resolveActivityValue
 * 对着用户 activities 表做（精确 id → 精确名 → 包含模糊 → other）。
 */
export const ActivityValue = z.string().trim().min(1).max(60);

export const ACTIVITY_NAMES: Record<(typeof ACTIVITY_IDS)[number], string> = {
  sleep: "睡眠", work: "工作", study: "学习", fitness: "健身",
  social: "社交", fun: "娱乐", chores: "家务", commute: "通勤", other: "其他",
};

/** 时间推断模式：显式时长 / 相对时段 / 类别默认 / 未来计划（→ 创建 TODO） */
export const TimeMode = z.enum(["explicit", "relative", "default", "future"]);

// 模型 confidence 偶发输出非数字（如 "medium"）→ 整包校验失败会白白丢弃其余合法字段；
// 容错为 0.5（低于 CONFIDENCE_THRESHOLD → 该域转 pending 待确认），宁让人工确认不可信结果。
// null 必须先短路：z.coerce 会把 null 强转成 0（Number(null)=0），与同文件 conf() 记录的坑相同
const llmConfidence = z
  .unknown()
  .transform((v) => (v == null ? 0.5 : v))
  .pipe(z.coerce.number().min(0).max(1).catch(0.5));

/** 模型布尔容错：z.coerce.boolean 会把字符串 "false" 强转成 true——纯感想句被模板字段幻影出日程/流水；
 * 这里只收真布尔/"true"/"false"/1/0，缺答或垃圾值按校验失败走修复重问（V2 漏答即不合格语义不变） */
const llmBoolean = z.any().transform((v, ctx) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  if (v === 1) return true;
  if (v === 0) return false;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "布尔字段需为 true/false" });
  return z.NEVER;
});

export const TimeBlock = z.object({
  mode: TimeMode,
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive(),
  confidence: llmConfidence,
});

/** YYYY-MM-DD 真实日历校验：形状 regex 只查格式不查日历——且 JS 对 2026-02-30 并非 Invalid Date，
 * 会静默进位成 3 月 2 日——按北京时区解析后回读比对年月日，假日期拒绝（与九轮 bjDate 修复同口径） */
export function isRealYmd(s: string): boolean {
  const t = Date.parse(`${s}T00:00:00+08:00`);
  if (Number.isNaN(t)) return false;
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10) === s;
}

/** 话术日期（北京 YYYY-MM-DD）：格式 + 真实日历双校验；畸形/假日期静默置 null（可选字段不打回重问，按当天记） */
const BjYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealYmd, { message: "日期须为真实日历日" })
  .nullish()
  .catch(null);

/** 财务域联动草稿（amountCents 恒为正数，方向由 direction 表达） */
export const FinanceDraft = z.object({
  hasAmount: z.boolean(),
  direction: z.enum(["out", "in"]).default("out"), // out=支出(花了/买了) in=收入(收到/到账)
  // >0 契约：「花了0元」曾产出 0 分流水——0/负数一律拒收（ruleExtract/rulesPipeline 双保险置 hasAmount=false）
  amountCents: z.number().int().nullish().refine((v) => v == null || v > 0),
  category: z.string().nullish(),
  counterparty: z.string().nullish(),
  /** 话术带日期的花销 → 发生日（北京 YYYY-MM-DD）；null=按当天记（REQ-009 FR-E6） */
  occurredDate: BjYmd,
});

/** 人际域联动草稿 */
export const PersonDraft = z.object({
  name: z.string(),
  event: z.string().nullish(), // 吃饭/送礼/通话/帮忙...
});

/** 饮食域：食物条目（kcal 可空 = 估不出） */
export const DietItem = z.object({
  name: z.string(),
  // 与 V2 面 DietItemV2（.max(20)）同口径：legacy 字符串金额无上限时失控模型回包可塞超长串透传
  amount: z.string().max(20).nullish(),
  kcal: z.coerce.number().int().positive().nullish(),
});
export const DietDraft = z.object({
  applicable: z.boolean().default(false),
  meal: z.enum(["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"]).default("未知"),
  items: z.array(DietItem).default([]),
  totalKcal: z.coerce.number().int().min(0).nullish(),
  confidence: z.coerce.number().min(0).max(1).default(0.8),
});

/** 五域识别域类型 */
export const DOMAINS = ["schedule", "todo", "finance", "mood", "diet", "people"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  schedule: "日程", todo: "待办", finance: "收支", mood: "心情", diet: "饮食", people: "关系",
};
export const DOMAIN_ICONS: Record<Domain, string> = {
  schedule: "🕒", todo: "📋", finance: "💰", mood: "😊", diet: "🍽", people: "👥",
};

/** 低置信阈值：低于此值的域不自动落库，转 pending 待用户确认 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** 空间归属分类（REQ-001 R3）：spaceId 必须来自候选列表或为 null */
export const SpaceClassification = z.object({
  spaceId: z.string().uuid().nullable(),
  confidence: llmConfidence,
});
export type SpaceClassificationT = z.infer<typeof SpaceClassification>;

/**
 * 瘦身开放词汇提取契约（REQ-003 3-D）：闭集判断由 Jev 并行完成，GLM 只出本契约字段。
 * 时间字段直接出 ISO-8601（与 FullExtractionV2 同标准）；缺字段按空处理（passthrough 禁止——防闭集字段混入）。
 */
/** 人名占位词断言：「省略/无/没有/null」不是真名字——V2 全量路径、规则路径、
 * OpenVocab（hybrid 合并层）三路防护必须同源，唯独一处漏配就会把占位词建成联系人 */
export const notPlaceholderName = (n: string) => !/^(省略|无|没有|null|none)$/i.test(n.trim());

export const OpenVocabExtraction = z.object({
  title: z.string().max(40).nullish(),
  start: z.string().min(1).nullish(),
  end: z.string().min(1).nullish(),
  due: z.string().min(1).nullish(),
  durationMin: z.coerce.number().int().positive().max(24 * 60).nullish(),
  people: z
    .array(z.object({ name: z.string().min(1).max(20).refine(notPlaceholderName, { message: "people[].name 不能是占位词" }), event: z.string().max(30).nullish() }))
    .max(10)
    .nullish(),
  dietItems: z
    // name 截到 16 对齐 DietItemV2/提示词（2-16字）：OpenVocab 20 字条目会穿透成另一形态落库
    .array(z.object({ name: z.string().min(1).max(20).transform((v) => capCodepoints(v, 16)), amount: z.string().max(20).nullish(), kcal: z.coerce.number().int().positive().max(5000).nullish() }))
    .max(20)
    .nullish(),
  mood: z.object({ label: z.string().max(10).nullish(), score: z.coerce.number().int().min(-100).max(100).nullish() }).nullish(),
  counterparty: z.string().max(20).nullish(),
  amountCents: z.coerce.number().int().positive().max(100_000_000).nullish(),
});
export type OpenVocabExtractionT = z.infer<typeof OpenVocabExtraction>;

export const ParseResult = z.object({
  // 规则引擎只产预设枚举，但 LLM 链路可能带自定义分类——统一放宽为字符串
  activity: ActivityValue.catch("other"),
  title: z.string().max(30),
  time: TimeBlock,
  /** 派生意图：todo=有待办｜schedule=有日程｜status=纯动态（两域都不适用） */
  intent: z.enum(["schedule", "todo", "status"]),
  /** 进行中：显式起止区间横跨当下（已开始未结束）→ 落日程块之外再生成收尾待办 */
  ongoing: z.boolean().default(false),
  /** 日程域是否命中（独立判定，不再强制） */
  scheduleApplicable: z.boolean().default(true),
  scheduleConfidence: z.coerce.number().min(0).max(1).default(0.9),
  todoConfidence: z.coerce.number().min(0).max(1).default(0.9),
  financeConfidence: z.coerce.number().min(0).max(1).default(0.9),
  mood: z.object({
    label: z.string().nullable(),
    score: z.number().int().min(-100).max(100).nullable(),
    confidence: z.coerce.number().min(0).max(1).default(0.9),
  }),
  diet: DietDraft,
  finance: FinanceDraft.default({ hasAmount: false }),
  people: z.array(PersonDraft).default([]),
  ambiguity: z.string().nullish(),
  /** dry-run（规则引擎）还是 LLM 产出；llm-repaired = 输出不合格经一次重问修复；jev-hybrid = Jev 闭集 + GLM 开放词汇混合（3-D） */
  engine: z.enum(["llm", "llm-repaired", "rules", "jev-hybrid"]),
  /** 灾难降级原因（engine=rules 时有值）：quota/auth/network/timeout/schema… 供日志与排查 */
  fallbackReason: z.string().nullish(),
});

export type ParseResult = z.infer<typeof ParseResult>;

/** 模型 confidence 容错：null/缺失给默认值（z.coerce 会把 null 强转成 0，必须先 nullish 短路）——仅规则兜底路径使用 */
const conf = (d: number) =>
  z.coerce.number().min(0).max(1).nullish().transform((v) => v ?? d);

// ============ v2 严格域契约（AI-first）：漏答即不合格 → 触发一次修复重问 ============

/** 北京时间本地时刻串 "YYYY-MM-DDTHH:MM"（或完整 ISO）——非空即需可被 Date 解析 */
const localMoment = z
  .string()
  .min(1)
  .refine((s) => !isNaN(new Date(s).getTime()), { message: "时刻须为可解析的 YYYY-MM-DDTHH:MM" });

/** 严格日程域：applicable=true → start/end 必填且 end 晚于 start */
export const ScheduleDraftV2 = z
  .object({
    applicable: llmBoolean,
    // 宽容归一（实测 2026-10-03）：纯花销/心情句模型常不给 schedule 的 activity/title，
    // 严格必填会打回重问再失败 → 整句降级规则兜底（金额/日期表达认不全）。
    // applicable=true 时 superRefine 仍强制 title 非空与 start/end，语义不变。
    // activity 放宽为字符串（预设 id 或用户自定义分类），服务端 resolveActivityValue 归一
    activity: ActivityValue.catch("other"),
    title: z.string().max(30).nullish().catch(""),
    start: localMoment.nullish(),
    end: localMoment.nullish(),
    durationMin: z.coerce.number().int().positive().max(24 * 60).nullish(),
    periodHint: z
      .enum(["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"])
      .nullish()
      .catch(null),
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (!v.applicable) return;
    if (!v.start || !v.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "schedule.applicable=true 时 start/end 必填" });
      return;
    }
    if (new Date(v.end).getTime() <= new Date(v.start).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "schedule.end 必须晚于 start" });
    }
    if (!v.title?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "schedule.applicable=true 时 title 必填" });
    }
  });

/** 严格待办域：applicable=true → due 必填 */
export const TodoDraftV2 = z
  .object({
    applicable: llmBoolean,
    due: localMoment.nullish(),
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (v.applicable && !v.due) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "todo.applicable=true 时 due 必填" });
    }
  });

/** 严格收支域：hasAmount=true → 金额与方向必填 */
export const FinanceDraftV2 = z
  .object({
    hasAmount: llmBoolean,
    direction: z.enum(["out", "in"]).nullish(),
    // 正数约束：hasAmount=false 时负数/0 可过 schema，mapAiResult 的 Math.abs 兜底会产出「hasAmount=false 但金额>0」的中介脏形态
    amountCents: z.coerce.number().int().max(100_000_000).refine((v) => v == null || v > 0).nullish(),
    // 截断到手动补录路径同款上限（分类/对方 ≤30）：模型抽风超长词直落流水列表/409 文案/AI 画像 prompt。
    // 用 transform 而非 max——max 会打回重问，整次抽取失败的代价远大于静默截断（title 同款取舍）
    category: z.string().nullish().transform((v) => capCodepoints(v, 30)),
    counterparty: z.string().nullish().transform((v) => capCodepoints(v, 30)),
    /** 话术带日期的花销 → 发生日 YYYY-MM-DD；畸形/假日期（2026-02-30）静默置 null（可选字段不打回重问） */
    occurredDate: BjYmd,
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (!v.hasAmount) return;
    if (v.amountCents == null || v.amountCents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finance.hasAmount=true 时 amountCents 必填（正数，分）" });
    }
    if (!v.direction) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finance.hasAmount=true 时 direction 必填（out/in）" });
    }
  });

/** 按码点截断（Array.from）：超长 AI 字段静默收敛到手动路径同款上限，防 UTF-16 码元截半 */
function capCodepoints(v: string, n: number): string;
function capCodepoints(v: string | null | undefined, n: number): string | null | undefined;
function capCodepoints(v: string | null | undefined, n: number): string | null | undefined {
  if (!v || v.length <= n) return v;
  return Array.from(v).slice(0, n).join("");
}

/** 严格心情域：有 label → score 必填 */
export const MoodDraftV2 = z
  .object({
    label: z.string().nullish().transform((v) => capCodepoints(v, 20)),
    score: z.coerce.number().int().min(-100).max(100).nullish(),
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (v.label && v.score == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "mood.label 非空时 score 必填" });
    }
  });

/** 严格饮食域：条目名 1-16 字（单字食物名如"盐/茶"合法）、禁止整句片段；
 * kcal/totalKcal 上限对齐 OpenVocab（5000）——直落 diet_records.total_kcal int4，模型抽风不得撑爆 */
export const DietItemV2 = z.object({
  name: z
    .string()
    .min(1)
    .max(16)
    .refine((n) => !/^(今天|今日|刚才|刚刚|我|现在)/.test(n.trim()), { message: "items[].name 不能是句子片段" }),
  // 上限与输出契约 DietItem.amount(.max(20)) 同口径：V2 放行超长串会在 mapAiResult 的
  // ParseResult 二次校验处炸掉——失败发生在 V2 safeParse 之后，绕过「校验失败重问一次」，
  // 一次五域全对的识别被单字段整包报废降级规则（十九轮补：max 只修了 legacy 面漏了 V2 面）
  amount: z.string().max(20).nullish(),
  kcal: z.coerce.number().int().positive().max(5000).nullish(),
});
export const DietDraftV2 = z
  .object({
    applicable: llmBoolean,
    meal: z.enum(["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"]).nullish().transform((m) => m ?? "未知"),
    items: z.array(DietItemV2).max(20).default([]),
    totalKcal: z.coerce.number().int().min(0).max(20000).nullish(),
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (v.applicable && v.items.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "diet.applicable=true 时 items 不能为空" });
    }
  });

export const PersonDraftV2 = z.object({
  // name 1-20 字 + people 上限对齐 OpenVocab（≤10 人）：一段话提到的人有限，防模型抽风产出脏数据/撑爆关联表
  name: z
    .string()
    .min(1)
    .max(20)
    .refine(notPlaceholderName, { message: "people[].name 不能是占位词" }),
  // 摘要截断到手动往来同款上限（≤30）：interactions.summary 直落时间轴与画像输入
  event: z.string().nullish().transform((v) => capCodepoints(v, 30)),
});

/** 全量抽取（发动态/编辑）：五域 + 人物，全部必答（不适用给 applicable=false） */
export const FullExtractionV2 = z.object({
  reasoning: z
    .object({
      schedule: z.string().nullish().catch(null),
      todo: z.string().nullish().catch(null),
      finance: z.string().nullish().catch(null),
      mood: z.string().nullish().catch(null),
      diet: z.string().nullish().catch(null),
    })
    .nullish()
    .transform((v) => v ?? {}),
  schedule: ScheduleDraftV2,
  todo: TodoDraftV2,
  finance: FinanceDraftV2,
  mood: MoodDraftV2,
  diet: DietDraftV2,
  people: z.array(PersonDraftV2).max(10).default([]),
  ambiguity: z.string().nullish().catch(null),
});

/** 单域抽取（识别菜单点某域）：只校验目标域，其余字段忽略 */
export function domainExtractionV2(domain: string): z.ZodTypeAny {
  switch (domain) {
    case "schedule": return z.object({ reasoning: z.string().nullish(), schedule: ScheduleDraftV2 });
    case "todo": return z.object({ reasoning: z.string().nullish(), todo: TodoDraftV2 });
    case "finance": return z.object({ reasoning: z.string().nullish(), finance: FinanceDraftV2 });
    case "mood": return z.object({ reasoning: z.string().nullish(), mood: MoodDraftV2 });
    case "diet": return z.object({ reasoning: z.string().nullish(), diet: DietDraftV2 });
    case "people": return z.object({ reasoning: z.string().nullish(), people: z.array(PersonDraftV2).max(10).default([]) });
    default: throw new Error(`未知域: ${domain}`);
  }
}

/**
 * LLM 的原始抽取结果（时间由确定性引擎计算，不让模型编时间戳）；数值宽容（模型偶发输出字符串数字）。
 * JSON 键序即生成序：reasoning 放最前引导模型先逐域判断再下结论（reasoning-before-answer）。
 *
 * ⚠ 仅类型用途（type-only）：运行时全量/单域校验走 V2 面（FullExtractionV2/domainExtractionV2/
 * OpenVocabExtraction → assembleExtraction 裸 as），本 schema 已无任何 .parse/.safeParse 调用方，
 * 字段约束也不再与真实装配体同步——改约束前先确认目标在 V2 面（十九轮注记，防误改错位）。
 */
export const LlmExtraction = z.object({
  reasoning: z
    .object({
      schedule: z.string().nullish().catch(null),
      todo: z.string().nullish().catch(null),
      finance: z.string().nullish().catch(null),
      mood: z.string().nullish().catch(null),
      diet: z.string().nullish().catch(null),
    })
    .nullish()
    .transform((v) => v ?? {}),
  /** 日程域：是否发生了/正在做某件具体的事 */
  schedule: z
    .object({
      applicable: z.coerce.boolean().default(true),
      activity: ActivityValue.default("other"),
      title: z.string().max(30),
      durationMin: z.coerce.number().int().positive().nullish(),
      /** AI 直推的起止时刻（北京时间本地串 "YYYY-MM-DDTHH:MM"）；语义含糊给 null 走规则推断 */
      start: z.string().nullish().catch(null),
      end: z.string().nullish().catch(null),
      periodHint: z
        .enum(["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"])
        .nullish()
        .catch(null),
      confidence: conf(0.9),
    })
    .nullish()
    .transform((v) => v ?? { applicable: true, activity: "other" as const, title: "", confidence: 0.5 }),
  /** 待办域：未来计划（明天/待会儿/打算/要去做） */
  todo: z
    .object({
      applicable: z.coerce.boolean().default(false),
      due: z.string().nullish().catch(null),
      confidence: conf(0.9),
    })
    .nullish()
    .transform((v) => v ?? { applicable: false, confidence: 0.5 }),
  finance: z
    .object({
      hasAmount: z.coerce.boolean().default(false),
      direction: z.enum(["out", "in"]).nullish().catch(null),
      amountCents: z.coerce.number().int().nullish(),
      category: z.string().nullish(),
      counterparty: z.string().nullish(),
      occurredDate: BjYmd,
      confidence: conf(0.9),
    })
    .nullish()
    .transform((v) => v ?? { hasAmount: false, confidence: 0.7 }),
  mood: z
    .object({
      label: z.string().nullish(),
      score: z.coerce.number().int().min(-100).max(100).nullish(),
      confidence: conf(0.9),
    })
    .nullish()
    .transform((v) => v ?? { label: null, score: null, confidence: 0.6 }),
  diet: DietDraft.extend({
      // 模型对非饮食句常输出 meal:null，枚举不收 null → 归一为"未知"
      meal: DietDraft.shape.meal.nullish().transform((m) => m ?? "未知"),
      confidence: conf(0.8),
    })
    .nullish()
    .catch(null)
    .transform((v) => v ?? { applicable: false, meal: "未知" as const, items: [], totalKcal: null, confidence: 0.5 }),
  people: z
    .array(z.object({ name: z.string(), event: z.string().nullish() }))
    .nullish()
    .transform((v) => v ?? []),
  ambiguity: z.string().nullish().catch(null),
});

export type LlmExtraction = z.infer<typeof LlmExtraction>;

// ============ 健身计划解析契约（REQ-016）：粘贴佳明课表等文本 → 结构化日计划草稿 ============
// 模型友好单位（km/min/kg/配速原文），apps/api 侧映射为整数口径（m/s/g）再入库；
// 力量动作不要求对齐动作库 id（模型不查库）——按名称在 api 侧匹配 fitness_exercises。

/** 跑步课分段（热身/间歇组/放松等）；距离驱动课给 distanceKm/paceText，时间驱动课（佳明截图步骤）给 durationMin */
export const RunSegmentDraft = z.object({
  label: z.string().min(1).max(20),
  distanceKm: z.coerce.number().positive().max(300).nullish(),
  /** 分段时长（分钟，"10:00" → 10）；与 distanceKm 二选一 */
  durationMin: z.coerce.number().min(0.5).max(300).nullish(),
  /** 配速原文（如 5'50" / 6:00-6:15），api 侧解析为秒每公里 */
  paceText: z.string().max(20).nullish(),
  hrZone: z.coerce.number().int().min(1).max(5).nullish(),
  /** 强度目标心率 bpm 原文（如 "134-161"）；用户心率分区未知，禁止折算进 hrZone */
  hrBpmText: z.string().max(20).nullish(),
  /** 重复次数（如 6×400m 的 6；无结构重复 null） */
  reps: z.coerce.number().int().min(2).max(40).nullish(),
  note: z.string().max(60).nullish(),
});

export const RunPlanDraft = z.object({
  workoutType: z.enum(["interval", "tempo", "long", "easy", "recovery"]),
  title: z.string().min(1).max(30),
  segments: z.array(RunSegmentDraft).max(12).default([]),
  totalDistanceKm: z.coerce.number().positive().max(300).nullish(),
  durationMin: z.coerce.number().int().min(5).max(600).nullish(),
  note: z.string().max(200).nullish(),
});

export const StrengthExerciseDraft = z.object({
  name: z.string().min(1).max(20).refine((n) => !/^(今天|今日|然后|接着|我)/.test(n.trim()), {
    message: "exercises[].name 不能是句子片段",
  }),
  sets: z.coerce.number().int().min(1).max(10).nullish(),
  /** 次数/时长原文（"10-12" / "30-45s" / "力竭-2"），保真入库 */
  repsText: z.string().max(12).nullish(),
  weightKg: z.coerce.number().min(0).max(500).nullish(),
  rir: z.coerce.number().int().min(0).max(10).nullish(),
  note: z.string().max(60).nullish(),
});

export const StrengthPlanDraft = z.object({
  title: z.string().min(1).max(30),
  exercises: z.array(StrengthExerciseDraft).min(1).max(15),
  /** 课表总时长（分钟，佳明截图概述「总时长」如 25:00 → 25）；课表没给就 null */
  durationMin: z.coerce.number().int().min(5).max(600).nullish(),
  note: z.string().max(200).nullish(),
});

/** 休息日草稿（REQ-019 FR-A1）：用户明确表示当天无训练 */
export const RestPlanDraft = z.object({
  note: z.string().max(100).nullish(),
});

/** 粘贴文本解析结果：module 与对应内容组必须匹配且非空（rest 例外——note 可空） */
export const FitnessPlanDraftV2 = z
  .object({
    reasoning: z.string().nullish(),
    module: z.enum(["run", "strength", "rest"]),
    run: RunPlanDraft.nullish(),
    strength: StrengthPlanDraft.nullish(),
    rest: RestPlanDraft.nullish(),
    confidence: llmConfidence,
  })
  .superRefine((v, ctx) => {
    if (v.module === "run" && !v.run) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "module=run 时 run 不能为空" });
    }
    if (v.module === "strength" && !v.strength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "module=strength 时 strength 不能为空" });
    }
  });
export type FitnessPlanDraft = z.infer<typeof FitnessPlanDraftV2>;
export type RunPlanDraftT = z.infer<typeof RunPlanDraft>;
export type StrengthPlanDraftT = z.infer<typeof StrengthPlanDraft>;

// ============ 训记动作名匹配契约（REQ-022）：识别出的动作名 → 训记官方动作库 ============
// apps/api 编排（规则快速通道 + 本契约批量匹配），返回的 official 由 api 侧校验必须 ∈ 目录（防编造）。

/** 单条匹配结果：official=null 表示目录里没有合理匹配（保留原名）；confidence 低于阈值同样视为未匹配 */
export const XunjiNameMatchItem = z.object({
  /** 待匹配原动作名（须与输入列表一致） */
  source: z.string().min(1).max(20),
  /** 训记官方动作名（必须逐字取自目录，禁止改写/编造） */
  official: z.string().min(1).max(30).nullish(),
  confidence: llmConfidence,
});

export const XunjiNameMatchResult = z.object({
  matches: z.array(XunjiNameMatchItem).min(1).max(15),
});
export type XunjiNameMatchResultT = z.infer<typeof XunjiNameMatchResult>;
