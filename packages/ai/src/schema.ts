/**
 * 解析结果 Schema —— 一句话输入的多域结构化输出
 * 对应 docs/06-时间日记模块-任务拆解.md §3.1
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

/** 时间推断模式：显式时长 / 相对时段 / 类别默认 */
export const TimeMode = z.enum(["explicit", "relative", "default"]);

export const TimeBlock = z.object({
  mode: TimeMode,
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

/** 财务域联动草稿 */
export const FinanceDraft = z.object({
  hasAmount: z.boolean(),
  amountCents: z.number().int().optional(), // 正=收入 负=支出
  category: z.string().optional(),
  counterparty: z.string().optional(),
});

/** 人际域联动草稿 */
export const PersonDraft = z.object({
  name: z.string(),
  event: z.string().optional(), // 吃饭/送礼/通话/帮忙...
});

export const ParseResult = z.object({
  activity: ActivityId,
  title: z.string().max(30),
  time: TimeBlock,
  finance: FinanceDraft.default({ hasAmount: false }),
  people: z.array(PersonDraft).default([]),
  ambiguity: z.string().nullish(),
  /** dry-run（规则引擎）还是 LLM 产出 */
  engine: z.enum(["llm", "rules"]),
});

export type ParseResult = z.infer<typeof ParseResult>;

/** LLM 的原始抽取结果（时间由确定性引擎计算，不让模型编时间戳） */
export const LlmExtraction = z.object({
  activity: ActivityId,
  title: z.string().max(30),
  durationMin: z.number().int().positive().nullish(),
  /** 话术中的相对时段词，如 "刚/中午/下午/晚上/凌晨" */
  periodHint: z
    .enum(["now", "morning", "noon", "afternoon", "evening", "night", "lateNight"])
    .nullish(),
  finance: FinanceDraft.default({ hasAmount: false }),
  people: z.array(PersonDraft).default([]),
  ambiguity: z.string().nullish(),
});

export type LlmExtraction = z.infer<typeof LlmExtraction>;
