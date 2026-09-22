/**
 * AI prompt 纳管（REQ-001 R4）：代码默认值注册表 + DB 覆盖读取。
 * - packages/ai 保持纯包；DB 感知只在 apps/api 本层
 * - getPrompt(key)：ai_prompts(enabled) → 代码默认值；进程内缓存 60s，保存后主动失效
 * - 管理端 API：/api/admin/prompts*
 */
import { pool } from "./db";
import { EXTRACT_SYSTEM_PROMPT, DOMAIN_PROMPTS } from "@shiguangri/ai";
import {
  REVIEW_DAY_SYSTEM,
  REVIEW_WEEK_SYSTEM,
  REVIEW_MONTH_SYSTEM,
  REVIEW_YEAR_SYSTEM,
  PROFILE_MERGE_SYSTEM,
  TRADE_REVIEW_WEEK_SYSTEM,
} from "./review-prompts";
import { OPEN_VOCAB_SYSTEM_PROMPT } from "@shiguangri/ai";
import { AI_INPUT_REGISTRY, mergeContextConfig } from "./ai-inputs";

export const PROMPT_KEYS = [
  "extract_full",
  "extract_open_vocab",
  "extract_domain_schedule",
  "extract_domain_todo",
  "extract_domain_finance",
  "extract_domain_mood",
  "extract_domain_diet",
  "extract_domain_people",
  "review_day",
  "review_week",
  "review_month",
  "review_year",
  "trade_review_week",
  "profile_merge",
  "space_classify",
  "todo_decompose",
  "action_decompose",
  "prompt_optimizer",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPT_META: Record<PromptKey, { title: string; category: "识别" | "复盘" | "目标" | "系统" }> = {
  extract_full: { title: "全量五域提取", category: "识别" },
  extract_open_vocab: { title: "瘦身开放词汇提取（Jev 接管）", category: "识别" },
  extract_domain_schedule: { title: "单域 · 日程", category: "识别" },
  extract_domain_todo: { title: "单域 · todo", category: "识别" },
  extract_domain_finance: { title: "单域 · 收支", category: "识别" },
  extract_domain_mood: { title: "单域 · 心情", category: "识别" },
  extract_domain_diet: { title: "单域 · 饮食", category: "识别" },
  extract_domain_people: { title: "单域 · 人物", category: "识别" },
  review_day: { title: "日小结", category: "复盘" },
  review_week: { title: "周复盘", category: "复盘" },
  review_month: { title: "月复盘", category: "复盘" },
  review_year: { title: "年复盘", category: "复盘" },
  trade_review_week: { title: "交易周复盘", category: "复盘" },
  profile_merge: { title: "月报画像合并", category: "复盘" },
  space_classify: { title: "空间归属分类", category: "目标" },
  todo_decompose: { title: "todo AI 拆解", category: "目标" },
  action_decompose: { title: "行动细化拆解", category: "目标" },
  prompt_optimizer: { title: "Prompt 优化器", category: "系统" },
};

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  extract_full: EXTRACT_SYSTEM_PROMPT,
  extract_open_vocab: OPEN_VOCAB_SYSTEM_PROMPT,
  extract_domain_schedule: DOMAIN_PROMPTS.schedule,
  extract_domain_todo: DOMAIN_PROMPTS.todo,
  extract_domain_finance: DOMAIN_PROMPTS.finance,
  extract_domain_mood: DOMAIN_PROMPTS.mood,
  extract_domain_diet: DOMAIN_PROMPTS.diet,
  extract_domain_people: DOMAIN_PROMPTS.people,
  review_day: REVIEW_DAY_SYSTEM,
  review_week: REVIEW_WEEK_SYSTEM,
  review_month: REVIEW_MONTH_SYSTEM,
  review_year: REVIEW_YEAR_SYSTEM,
  trade_review_week: TRADE_REVIEW_WEEK_SYSTEM,
  profile_merge: PROFILE_MERGE_SYSTEM,
  space_classify: `你是"拾光"App 的目标空间分类器。判断用户的这条记录是否服务于某个「目标空间」（用户定义的长期目标容器，如考研上岸、副业过万、完成全马）。

## 判定标准
- 记录内容与某空间的名称/描述直接相关（推进、练习、学习、相关花销、相关人际）→ spaceId = 该空间 id
- 相关性弱、只是一般生活记录、或拿不准 → spaceId = null（宁可不归属，禁止为了归属而归属）

## 输出
只输出 JSON：{"spaceId":"<候选列表中的id或null>","confidence":0~1}`,
  todo_decompose: `你是"拾光"App 的任务拆解引擎。把一个 todo 拆解为若干可执行的「行动」。

## 行动定义（严格）
- 以动词开头、单一产出、一次专注（25 分钟~2 小时）内可完成、完成与否可判定
- 覆盖「准备→执行→收尾」闭环；上限不是目标——通常 3~6 个足够，宁缺毋滥

## 去重
已有行动清单会随消息给出（可能为空）：禁止生成语义重复项。

## 输出
先思考后输出。只输出 JSON：{"reasoning":"一句话思路","actions":[{"title":"≤30字行动"}]}`,
  action_decompose: `你是"拾光"App 的行动细化引擎。把一个偏大的「行动」细化为若干更小的同级行动——下一步就能动手的那种。

## 要求
- 新行动与原行动同级、按执行顺序排列（会被插入到原行动之后，原行动保留）
- 若原行动已足够小，允许返回 1 项甚至 0 项
- 行动定义：动词开头、单一产出、一次专注（25 分钟~2 小时）内可完成、可判定

## 去重
已有行动清单（含锚点前后邻居）会随消息给出：禁止语义重复。

## 输出
只输出 JSON：{"reasoning":"一句话思路","actions":[{"title":"≤30字行动"}]}`,
  prompt_optimizer: `你是资深的 prompt 工程专家，负责优化「拾光」个人经营系统的 AI 提示词。输入分四块：【用途】【必须保留的契约约束】【当前 prompt】【优化意图】。

## 硬性规则（违反即无效）
1. 不得改变输出 JSON 的字段名与结构，不得删除或改写任何占位符（如 {text}、{nowCst}、{spaces}）；
2. 不得突破字段枚举值与取值范围；
3. 只优化：措辞清晰度、判定规则的明确性与可执行性、示例质量、结构组织、token 效率；
4. 保持原文语言（中文）与格式风格（Markdown 标题 + JSON 契约）。

## 输出
从优化后的 prompt 正文第一行开始输出全文，直到正文最后一行为止——禁止复述【用途】【契约约束】等输入块，禁止任何解释、前后缀或代码块围栏。`,
};

// ---- 进程内缓存（60s；standalone 常驻进程，保存后同进程 Map.delete 即时生效） ----
const CACHE_TTL_MS = 60_000;
interface BundleCacheEntry {
  content: string;
  userTemplate: string;
  config: { inject: Record<string, boolean>; caps: Record<string, number> };
  fetchedAt: number;
}
const cache = new Map<PromptKey, BundleCacheEntry>();

/** 代码默认值全文（管理端对比/回退用） */
export function defaultPrompt(key: PromptKey): string {
  return DEFAULT_PROMPTS[key];
}

/** 清缓存：不传 key 全清（保存/回滚/开关切换后调用） */
export function invalidatePrompts(key?: PromptKey): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/** 生效中的 prompt：DB 覆盖（enabled=true）优先，否则代码默认值 */
export async function getPrompt(key: PromptKey): Promise<string> {
  return (await getPromptBundle(key)).system;
}

/** 生效中的 system + user 模板 + 注入配置三件套（REQ-003 3-A）。
 * DB 覆盖（enabled=true）优先；user_template/config 为空 = 代码默认；60s 缓存，保存主动失效 */
export async function getPromptBundle(key: PromptKey): Promise<PromptBundle> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { system: hit.content, userTemplate: hit.userTemplate, config: hit.config };
  }
  const spec = AI_INPUT_REGISTRY[key];
  const bundle: PromptBundle = {
    system: DEFAULT_PROMPTS[key],
    userTemplate: spec.userTemplate,
    config: mergeContextConfig(key, null),
  };
  try {
    const { rows } = await pool.query(
      `select content, enabled, user_template, context_config from ai_prompts where key = $1`,
      [key],
    );
    const row = rows[0];
    if (row?.enabled) {
      if (typeof row.content === "string" && row.content.trim()) bundle.system = row.content;
      if (typeof row.user_template === "string" && row.user_template.trim()) bundle.userTemplate = row.user_template;
      // context_config 为 JSONB（node-pg 已 parse 为对象）；与注册表默认合并（required 强制 true、caps 钳制范围）
      bundle.config = mergeContextConfig(key, (row.context_config ?? null) as { inject?: Record<string, boolean>; caps?: Record<string, number> } | null);
    }
  } catch (e) {
    console.warn(`[prompts] 读取 ${key} 三件套覆盖失败，用代码默认：`, String(e).slice(0, 120));
  }
  cache.set(key, {
    content: bundle.system,
    userTemplate: bundle.userTemplate,
    config: bundle.config,
    fetchedAt: Date.now(),
  });
  return bundle;
}

export interface PromptBundle {
  system: string;
  userTemplate: string;
  config: { inject: Record<string, boolean>; caps: Record<string, number> };
}

/** 统一装配器（REQ-003 FR-A3）：按模板替换占位符 + 空块折叠。
 * ctx 由调用方按 bundle.config 构造（开关关闭的注入项不取数、cap 在查询层生效），关闭项传空串即可。 */
export function assembleUserPrompt(key: PromptKey, bundle: PromptBundle, ctx: Record<string, string>): string {
  const spec = AI_INPUT_REGISTRY[key];
  let out = bundle.userTemplate;
  for (const ph of spec.placeholders) {
    out = out.split(`{${ph}}`).join(ctx[ph] ?? "");
  }
  // 清理空块留下的行尾空白与 3+ 连续换行（段落间距保留为空行）
  return out
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
