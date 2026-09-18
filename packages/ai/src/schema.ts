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

export const ParseResult = z.object({
  activity: ActivityId,
  title: z.string().max(30),
  time: TimeBlock,
  /** 派生意图：todo=有待办｜schedule=有日程｜status=纯动态（两域都不适用） */
  intent: z.enum(["schedule", "todo", "status"]),
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
  /** dry-run（规则引擎）还是 LLM 产出 */
  engine: z.enum(["llm", "rules"]),
});

export type ParseResult = z.infer<typeof ParseResult>;

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
      periodHint: z
        .enum(["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"])
        .nullish()
        .catch(null),
      confidence: z.coerce.number().min(0).max(1).default(0.9),
    })
    .nullish()
    .transform((v) => v ?? { applicable: true, activity: "other" as const, title: "", confidence: 0.5 }),
  /** 待办域：未来计划（明天/待会儿/打算/要去做） */
  todo: z
    .object({
      applicable: z.coerce.boolean().default(false),
      confidence: z.coerce.number().min(0).max(1).default(0.9),
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
      confidence: z.coerce.number().min(0).max(1).default(0.9),
    })
    .nullish()
    .transform((v) => v ?? { hasAmount: false, confidence: 0.7 }),
  mood: z
    .object({
      label: z.string().nullish(),
      score: z.coerce.number().int().min(-100).max(100).nullish(),
      confidence: z.coerce.number().min(0).max(1).default(0.9),
    })
    .nullish()
    .transform((v) => v ?? { label: null, score: null, confidence: 0.6 }),
  diet: DietDraft.nullish().transform((v) => v ?? { applicable: false, meal: "未知", items: [], totalKcal: null, confidence: 0.5 }),
  people: z
    .array(z.object({ name: z.string(), event: z.string().nullish() }))
    .nullish()
    .transform((v) => v ?? []),
  ambiguity: z.string().nullish().catch(null),
});

export type LlmExtraction = z.infer<typeof LlmExtraction>;
