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

export const ACTIVITY_NAMES: Record<(typeof ACTIVITY_IDS)[number], string> = {
  sleep: "睡眠", work: "工作", study: "学习", fitness: "健身",
  social: "社交", fun: "娱乐", chores: "家务", commute: "通勤", other: "其他",
};

/** 时间推断模式：显式时长 / 相对时段 / 类别默认 / 未来计划（→ 创建 TODO） */
export const TimeMode = z.enum(["explicit", "relative", "default", "future"]);

export const TimeBlock = z.object({
  mode: TimeMode,
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

/** 财务域联动草稿（amountCents 恒为正数，方向由 direction 表达） */
export const FinanceDraft = z.object({
  hasAmount: z.boolean(),
  direction: z.enum(["out", "in"]).default("out"), // out=支出(花了/买了) in=收入(收到/到账)
  amountCents: z.number().int().nullish(),
  category: z.string().nullish(),
  counterparty: z.string().nullish(),
});

/** 人际域联动草稿 */
export const PersonDraft = z.object({
  name: z.string(),
  event: z.string().nullish(), // 吃饭/送礼/通话/帮忙...
});

/** 饮食域：食物条目（kcal 可空 = 估不出） */
export const DietItem = z.object({
  name: z.string(),
  amount: z.string().nullish(),
  kcal: z.coerce.number().int().positive().nullish(),
});
export const DietDraft = z.object({
  applicable: z.boolean().default(false),
  meal: z.enum(["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"]).default("未知"),
  items: z.array(DietItem).default([]),
  totalKcal: z.coerce.number().int().nullish(),
  confidence: z.coerce.number().min(0).max(1).default(0.8),
});

/** 五域识别域类型 */
export const DOMAINS = ["schedule", "todo", "finance", "mood", "diet"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  schedule: "日程", todo: "待办", finance: "收支", mood: "心情", diet: "饮食",
};
export const DOMAIN_ICONS: Record<Domain, string> = {
  schedule: "🕒", todo: "📋", finance: "💰", mood: "😊", diet: "🍽",
};

/** 低置信阈值：低于此值的域不自动落库，转 pending 待用户确认 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** 空间归属分类（REQ-001 R3）：spaceId 必须来自候选列表或为 null */
export const SpaceClassification = z.object({
  spaceId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
});
export type SpaceClassificationT = z.infer<typeof SpaceClassification>;

/**
 * 瘦身开放词汇提取契约（REQ-003 3-D）：闭集判断由 Jev 并行完成，GLM 只出本契约字段。
 * 时间字段直接出 ISO-8601（与 FullExtractionV2 同标准）；缺字段按空处理（passthrough 禁止——防闭集字段混入）。
 */
export const OpenVocabExtraction = z.object({
  title: z.string().max(40).nullish(),
  start: z.string().min(1).nullish(),
  end: z.string().min(1).nullish(),
  due: z.string().min(1).nullish(),
  durationMin: z.coerce.number().int().positive().max(24 * 60).nullish(),
  people: z
    .array(z.object({ name: z.string().min(1).max(20), event: z.string().max(30).nullish() }))
    .max(10)
    .nullish(),
  dietItems: z
    .array(z.object({ name: z.string().min(1).max(20), amount: z.string().max(20).nullish(), kcal: z.coerce.number().int().positive().max(5000).nullish() }))
    .max(20)
    .nullish(),
  mood: z.object({ label: z.string().max(10).nullish(), score: z.coerce.number().int().min(-100).max(100).nullish() }).nullish(),
  counterparty: z.string().max(20).nullish(),
  amountCents: z.coerce.number().int().positive().max(100_000_000).nullish(),
});
export type OpenVocabExtractionT = z.infer<typeof OpenVocabExtraction>;

export const ParseResult = z.object({
  activity: ActivityId,
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
    applicable: z.coerce.boolean(),
    activity: ActivityId,
    title: z.string().max(30),
    start: localMoment.nullish(),
    end: localMoment.nullish(),
    durationMin: z.coerce.number().int().positive().nullish(),
    periodHint: z
      .enum(["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"])
      .nullish()
      .catch(null),
    confidence: z.coerce.number().min(0).max(1),
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
    if (!v.title.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "schedule.applicable=true 时 title 必填" });
    }
  });

/** 严格待办域：applicable=true → due 必填 */
export const TodoDraftV2 = z
  .object({
    applicable: z.coerce.boolean(),
    due: localMoment.nullish(),
    confidence: z.coerce.number().min(0).max(1),
  })
  .superRefine((v, ctx) => {
    if (v.applicable && !v.due) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "todo.applicable=true 时 due 必填" });
    }
  });

/** 严格收支域：hasAmount=true → 金额与方向必填 */
export const FinanceDraftV2 = z
  .object({
    hasAmount: z.coerce.boolean(),
    direction: z.enum(["out", "in"]).nullish(),
    amountCents: z.coerce.number().int().nullish(),
    category: z.string().nullish(),
    counterparty: z.string().nullish(),
    confidence: z.coerce.number().min(0).max(1),
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

/** 严格心情域：有 label → score 必填 */
export const MoodDraftV2 = z
  .object({
    label: z.string().nullish(),
    score: z.coerce.number().int().min(-100).max(100).nullish(),
    confidence: z.coerce.number().min(0).max(1),
  })
  .superRefine((v, ctx) => {
    if (v.label && v.score == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "mood.label 非空时 score 必填" });
    }
  });

/** 严格饮食域：条目名 2-16 字、禁止整句片段 */
export const DietItemV2 = z.object({
  name: z
    .string()
    .min(2)
    .max(16)
    .refine((n) => !/^(今天|今日|刚才|刚刚|我|现在)/.test(n.trim()), { message: "items[].name 不能是句子片段" }),
  amount: z.string().nullish(),
  kcal: z.coerce.number().int().positive().nullish(),
});
export const DietDraftV2 = z
  .object({
    applicable: z.coerce.boolean(),
    meal: z.enum(["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"]).nullish().transform((m) => m ?? "未知"),
    items: z.array(DietItemV2).default([]),
    totalKcal: z.coerce.number().int().nullish(),
    confidence: z.coerce.number().min(0).max(1),
  })
  .superRefine((v, ctx) => {
    if (v.applicable && v.items.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "diet.applicable=true 时 items 不能为空" });
    }
  });

export const PersonDraftV2 = z.object({
  name: z.string().min(1).refine((n) => !/^(省略|无|没有|null|none)$/i.test(n.trim()), { message: "people[].name 不能是占位词" }),
  event: z.string().nullish(),
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
  people: z.array(PersonDraftV2).default([]),
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
    case "people": return z.object({ reasoning: z.string().nullish(), people: z.array(PersonDraftV2).default([]) });
    default: throw new Error(`未知域: ${domain}`);
  }
}

/**
 * LLM 的原始抽取结果（时间由确定性引擎计算，不让模型编时间戳）；数值宽容（模型偶发输出字符串数字）。
 * JSON 键序即生成序：reasoning 放最前引导模型先逐域判断再下结论（reasoning-before-answer）。
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
      activity: ActivityId.default("other"),
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
