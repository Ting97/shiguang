/**
 * AI 输入注册表（REQ-003 3-A / FR-1.7）：每个 prompt key 的 user 侧可调面唯一事实源。
 * - 默认 user 模板 1:1 复刻改造前的硬编码输出（未配置时装配结果与线上一致）
 * - injects：非必需注入项（可开关）；required 锁定不可关
 * - caps：数值参数（明细行上限等），min/max 由注册表声明；行类上限 0 = 不设限
 * - 后台只开放注册表内的项，不支持自由增删注入源
 */
import type { PromptKey } from "./prompts";

export interface InjectSpec {
  key: string;
  label: string;
  desc: string;
  source: string;
  /** 必需注入项：保存时 API 强拒 false，前端锁定 */
  required?: boolean;
  default: boolean;
}

export interface CapSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface InputSpec {
  /** 代码默认 user 模板（{占位符} 形式） */
  userTemplate: string;
  /** 合法占位符全集（保存校验用） */
  placeholders: string[];
  injects: InjectSpec[];
  caps: CapSpec[];
}

const REQ = (key: string, label: string, desc: string, source: string): InjectSpec => ({
  key, label, desc, source, required: true, default: true,
});
const OPT = (key: string, label: string, desc: string, source: string): InjectSpec => ({
  key, label, desc, source, default: true,
});
const CAP_LINES = (key: string, label: string, def: number): CapSpec => ({
  key, label, min: 0, max: 5000, default: def,
});

// ---- 识别类通用片段 ----
const EXTRACT_FULL_TEMPLATE = `当前时间：{nowCst}
分类对照：{catList}{contactList}
用户的话：「{text}」`;
const EXTRACT_PLAIN_TEMPLATE = `当前时间：{nowCst}
用户的话：「{text}」`;
const EXTRACT_PEOPLE_TEMPLATE = `当前时间：{nowCst}{contactList}
用户的话：「{text}」`;

const CONTACT_INJECT = (withCat: boolean): InjectSpec[] => [
  ...(withCat
    ? [OPT("contactList", "联系人名单", "用户已有联系人，人物识别时把称呼对齐到名单原文、避免重复建档", "contacts 表按最近往来排序")]
    : []),
];
// extract_full 的注入项（分类对照 + 联系人）
const EXTRACT_FULL_INJECTS: InjectSpec[] = [
  OPT("catList", "分类对照", "九大活动分类 id=中文名 对照表，schedule.activity 取值依据", "代码枚举 ACTIVITY_NAMES"),
  OPT("contactList", "联系人名单", "用户已有联系人，人物识别时把称呼对齐到名单原文、避免重复建档", "contacts 表按最近往来排序"),
];
const EXTRACT_FULL_CAPS: CapSpec[] = [
  { key: "catCount", label: "分类对照条数", min: 1, max: 50, default: 50 },
  { key: "contactCount", label: "联系人名单条数", min: 0, max: 500, default: 100 },
];

// ---- 复盘类通用注入/参数 ----
const REVIEW_INJECTS = (withChain: boolean): InjectSpec[] => [
  ...(withChain ? [OPT("chainBlock", "下层小结链", "周←各日小结 / 月←各周小结 / 年←各月月报，只取已有缓存", "review_caches 表")] : []),
  OPT("entryDetail", "动态明细", "当期原始动态逐条（时间+原文+心情），给模型一手记录", "entries 表当期范围"),
  OPT("blockDetail", "日程块明细", "当期时间块逐条（起止+分类+标题）", "time_blocks 表当期范围"),
  OPT("todoDetail", "完成 todo 明细", "当期完成的待办逐条", "todos 表 done 当期范围"),
  OPT("profileBlock", "画像注入", "用户画像块（习惯/偏好/规律/事实），供个性化解读", "user_ai_profiles 表"),
];
const REVIEW_REQUIRED: InjectSpec[] = [REQ("facts", "事实聚合", "当期时间/待办/收支/人际/心情聚合行", "多表实时聚合")];
const REVIEW_CAPS = (entry: number, block: number, todo: number): CapSpec[] => [
  CAP_LINES("entryCap", "动态明细行上限（0=不设限）", entry),
  CAP_LINES("blockCap", "日程块明细行上限（0=不设限）", block),
  CAP_LINES("todoCap", "完成 todo 明细行上限（0=不设限）", todo),
];

const REVIEW_TEMPLATE = (chainLabel: string) =>
  `{facts}

${chainLabel}{entryDetail}

{blockDetail}

{todoDetail}

{profileBlock}`;
// 占位符顺序：chainBlock 在前（与现状 userPrompt 组装顺序一致：facts → 小结链 → 明细 → 画像）
const REVIEW_TEMPLATE_CHAIN = `{facts}

{chainBlock}

{entryDetail}

{blockDetail}

{todoDetail}

{profileBlock}`;

const DECOMPOSE_TEMPLATE = `{todoBlock}

{spaceBlock}

{existingBlock}

{profileBlock}

请拆解：{target}{modeSuffix}`;

export const AI_INPUT_REGISTRY: Record<PromptKey, InputSpec> = {
  extract_full: {
    userTemplate: EXTRACT_FULL_TEMPLATE,
    placeholders: ["nowCst", "catList", "contactList", "text"],
    injects: [...EXTRACT_FULL_INJECTS, REQ("nowCst", "当前时间", "北京时间（YYYY-MM-DD HH:MM ddd），相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: EXTRACT_FULL_CAPS,
  },
  extract_domain_schedule: {
    userTemplate: EXTRACT_PLAIN_TEMPLATE,
    placeholders: ["nowCst", "text"],
    injects: [REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [],
  },
  extract_domain_todo: {
    userTemplate: EXTRACT_PLAIN_TEMPLATE,
    placeholders: ["nowCst", "text"],
    injects: [REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [],
  },
  extract_domain_finance: {
    userTemplate: EXTRACT_PLAIN_TEMPLATE,
    placeholders: ["nowCst", "text"],
    injects: [REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [],
  },
  extract_domain_mood: {
    userTemplate: EXTRACT_PLAIN_TEMPLATE,
    placeholders: ["nowCst", "text"],
    injects: [REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [],
  },
  extract_domain_diet: {
    userTemplate: EXTRACT_PLAIN_TEMPLATE,
    placeholders: ["nowCst", "text"],
    injects: [REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [],
  },
  extract_domain_people: {
    userTemplate: EXTRACT_PEOPLE_TEMPLATE,
    placeholders: ["nowCst", "contactList", "text"],
    injects: [...CONTACT_INJECT(false), REQ("nowCst", "当前时间", "北京时间，相对时间推算基准", "服务端时钟"), REQ("text", "用户话术", "动态原文，识别对象本体", "本次输入")],
    caps: [{ key: "contactCount", label: "联系人名单条数", min: 0, max: 500, default: 100 }],
  },
  review_day: {
    userTemplate: REVIEW_TEMPLATE(""),
    placeholders: ["facts", "entryDetail", "blockDetail", "todoDetail", "profileBlock"],
    injects: [...REVIEW_INJECTS(false), ...REVIEW_REQUIRED],
    caps: REVIEW_CAPS(500, 0, 0),
  },
  review_week: {
    userTemplate: REVIEW_TEMPLATE_CHAIN,
    placeholders: ["facts", "chainBlock", "entryDetail", "blockDetail", "todoDetail", "profileBlock"],
    injects: [...REVIEW_INJECTS(true), ...REVIEW_REQUIRED],
    caps: REVIEW_CAPS(200, 100, 100),
  },
  review_month: {
    userTemplate: REVIEW_TEMPLATE_CHAIN,
    placeholders: ["facts", "chainBlock", "entryDetail", "blockDetail", "todoDetail", "profileBlock"],
    injects: [...REVIEW_INJECTS(true), ...REVIEW_REQUIRED],
    caps: REVIEW_CAPS(300, 150, 150),
  },
  review_year: {
    userTemplate: REVIEW_TEMPLATE_CHAIN,
    placeholders: ["facts", "chainBlock", "entryDetail", "blockDetail", "todoDetail", "profileBlock"],
    injects: [...REVIEW_INJECTS(true), ...REVIEW_REQUIRED],
    caps: REVIEW_CAPS(60, 100, 100),
  },
  profile_merge: {
    userTemplate: `旧画像：
{oldProfile}

本月（{period}）事实：
{factsText}

本月复盘：
{reviewText}`,
    placeholders: ["oldProfile", "period", "factsText", "reviewText"],
    injects: [
      REQ("oldProfile", "旧画像", "上期合并出的用户画像（首期为占位说明）", "user_ai_profiles 表"),
      REQ("period", "期间标注", "合并的月份标注", "调用参数"),
      REQ("factsText", "本月事实", "月度聚合事实文本", "上层传入"),
      REQ("reviewText", "本月复盘", "刚生成的月报 JSON", "上层传入"),
    ],
    caps: [{ key: "profileItems", label: "画像条数上限", min: 1, max: 200, default: 40 }],
  },
  space_classify: {
    userTemplate: `候选空间：
{candidates}

用户记录：「{text}」`,
    placeholders: ["candidates", "text"],
    injects: [
      REQ("candidates", "候选空间列表", "active 空间 id：名称（描述）清单", "goal_spaces 表"),
      REQ("text", "用户记录", "动态原文（≤500 字）", "本次输入"),
    ],
    caps: [{ key: "spaceCount", label: "候选空间上限", min: 1, max: 100, default: 20 }],
  },
  todo_decompose: {
    userTemplate: DECOMPOSE_TEMPLATE,
    placeholders: ["todoBlock", "spaceBlock", "existingBlock", "profileBlock", "target", "modeSuffix"],
    injects: [
      REQ("todoBlock", "todo 上下文", "标题与相关描述（必需）", "todos 表"),
      OPT("spaceBlock", "空间上下文", "所属空间名称与描述，让行动贴合目标", "goal_spaces 表"),
      OPT("existingBlock", "已有行动清单", "去重依据：禁止生成语义重复项", "todos 表已有行动"),
      OPT("profileBlock", "画像注入", "用户画像块，供贴合个人情况", "user_ai_profiles 表"),
    ],
    caps: [{ key: "existingCount", label: "已有行动条数", min: 0, max: 200, default: 30 }],
  },
  action_decompose: {
    userTemplate: DECOMPOSE_TEMPLATE,
    placeholders: ["todoBlock", "spaceBlock", "existingBlock", "profileBlock", "target", "modeSuffix"],
    injects: [
      REQ("todoBlock", "行动上下文", "行动+所属 todo 标题与描述（必需）", "todos 表"),
      OPT("spaceBlock", "空间上下文", "所属空间名称与描述", "goal_spaces 表"),
      OPT("existingBlock", "已有行动清单", "去重依据（含锚点邻居）", "todos 表已有行动"),
      OPT("profileBlock", "画像注入", "用户画像块", "user_ai_profiles 表"),
    ],
    caps: [{ key: "existingCount", label: "已有行动条数", min: 0, max: 200, default: 30 }],
  },
  prompt_optimizer: {
    userTemplate: `【用途】{purpose}

{contract}

【当前 prompt】
{current}

【优化意图】{intent}`,
    placeholders: ["purpose", "contract", "current", "intent"],
    injects: [
      REQ("purpose", "用途说明", "目标 prompt 的标题与 key", "注册表元信息"),
      REQ("contract", "契约约束", "必须保留的输出结构/枚举/占位符约束", "代码 CONTRACT_HINTS"),
      REQ("current", "当前 prompt", "待优化的 system prompt 全文", "当前生效 prompt"),
      REQ("intent", "优化意图", "管理员的优化方向说明", "本次输入"),
    ],
    caps: [],
  },
};

/** 合并 DB 覆盖与注册表默认：inject 缺省=注册表默认，caps 数值钳制到 [min,max] */
export function mergeContextConfig(
  key: PromptKey,
  dbConfig: { inject?: Record<string, boolean>; caps?: Record<string, number> } | null,
): { inject: Record<string, boolean>; caps: Record<string, number> } {
  const spec = AI_INPUT_REGISTRY[key];
  const inject: Record<string, boolean> = {};
  for (const i of spec.injects) inject[i.key] = i.required ? true : i.default;
  const caps: Record<string, number> = {};
  for (const c of spec.caps) caps[c.key] = c.default;
  if (dbConfig) {
    if (dbConfig.inject) {
      for (const i of spec.injects) {
        if (i.required) continue;
        const v = dbConfig.inject[i.key];
        if (typeof v === "boolean") inject[i.key] = v;
      }
    }
    if (dbConfig.caps) {
      for (const c of spec.caps) {
        const v = dbConfig.caps[c.key];
        if (typeof v === "number" && Number.isFinite(v)) caps[c.key] = Math.min(c.max, Math.max(c.min, Math.round(v)));
      }
    }
  }
  return { inject, caps };
}

/** user 模板占位符完整性校验（FR-1.2）：缺失与未知占位符清单（空数组=合法） */
export function validateUserTemplate(key: PromptKey, tpl: string): { missing: string[]; unknown: string[] } {
  const spec = AI_INPUT_REGISTRY[key];
  const found = new Set<string>();
  const re = /\{([a-zA-Z_]\w*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) found.add(m[1]);
  const known = new Set(spec.placeholders);
  return {
    missing: spec.placeholders.filter((p) => !found.has(p)),
    unknown: [...found].filter((p) => !known.has(p)),
  };
}
