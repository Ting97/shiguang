import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/identity/auth";
import { chat } from "@shiguangri/ai";
import { PROMPT_KEYS, PROMPT_META, getPrompt, getPromptBundle, assembleUserPrompt, type PromptKey } from "@/server/ai/prompts";
import { writeAuditRecord } from "@/server/ai/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/prompts/[key]/optimize {hint?} —— AI 协助优化（v1.1）
 * 用 prompt_optimizer 元 prompt 组装：用途 + 契约约束 + 当前内容 + 意图 → chat()
 * 纯建议：不落库、不写版本、不动缓存；记 audit_logs stage='prompt_optimize'
 */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const startedAt = Date.now();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { hint } = (await req.json().catch(() => ({}))) as { hint?: string };
  const target = (await getPrompt(key as PromptKey)).slice(0, 30_000);
  // 优化器自身也走三件套装配（3-A：prompt_optimizer 的 user 模板/注入可在后台调）
  const optBundle = await getPromptBundle("prompt_optimizer");
  const contract = CONTRACT_HINTS[key as PromptKey]
    ? `【必须保留的契约约束】\n${CONTRACT_HINTS[key as PromptKey]}`
    : "【必须保留的契约约束】\n保持原文中的输出 JSON 结构、字段名、枚举值与占位符完全不变。";

  const userPrompt = assembleUserPrompt("prompt_optimizer", optBundle, {
    purpose: `${PROMPT_META[key as PromptKey].title}（key=${key}）——「拾光」系统的 AI 提示词`,
    contract,
    current: target,
    intent: hint?.trim() ? hint.trim().slice(0, 500) : "（无，按专家判断全面优化）",
  });

  const t0 = Date.now();
  try {
    const suggestion = await chat({
      system: optBundle.system,
      user: userPrompt,
      temperature: 0.3,
      maxTokens: 8000,
      timeoutMs: 60_000,
      onUsage: (u) => {
        void writeAuditRecord({
          userId: user.id, entryId: null, stage: "prompt_optimize",
          model: process.env.GLM_MODEL ?? "glm-5.3-flash", engine: "prompt-optimize",
          latencyMs: Date.now() - t0, ok: true,
          promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens,
        });
      },
    });
    const cleaned = suggestion
      .trim()
      .replace(/^```(?:\w*)\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    if (!cleaned) throw new Error("优化结果为空");
    // 弱模型偶发复述输入块（【用途】…【当前 prompt】…）——启发式剥离，只留正文
    const echoIdx = cleaned.lastIndexOf("【当前 prompt】");
    const body = echoIdx >= 0 ? cleaned.slice(echoIdx + "【当前 prompt】".length).trim() : cleaned;
    if (!body) throw new Error("优化结果为空");
    return NextResponse.json({ ok: true, suggestion: body, latencyMs: Date.now() - startedAt });
  } catch (e) {
    void writeAuditRecord({
      userId: user.id, entryId: null, stage: "prompt_optimize",
      model: process.env.GLM_MODEL ?? "glm-5.3-flash", engine: "prompt-optimize",
      latencyMs: Date.now() - t0, ok: false, error: String(e).slice(0, 300),
    });
    return NextResponse.json({ error: `AI 优化失败：${e instanceof Error ? e.message : String(e).slice(0, 200)}` }, { status: 502 });
  }
}

/** 各 key 的契约要点：拼进优化器输入，硬约束 LLM 不许改输出结构 */
const CONTRACT_HINTS: Partial<Record<PromptKey, string>> = {
  extract_full: `输出 JSON 结构（reasoning + schedule/todo/finance/mood/diet/people/ambiguity）与全部字段名、枚举（activity 9 值、meal 6 值、direction out/in、category 7 值）不变；用户消息中的占位（当前时间/分类对照/联系人名单/「用户的话」）由 buildExtractUserPrompt 拼装，prompt 中对它们的引用描述不能失效。`,
  extract_domain_schedule: `只输出 {"reasoning","schedule":{...}}，字段与枚举（activity 9 值）不变。`,
  extract_domain_todo: `只输出 {"reasoning","todo":{"applicable","due","confidence"}} 结构不变。`,
  extract_domain_finance: `只输出 {"reasoning","finance":{...}}，direction/category 枚举不变。`,
  extract_domain_mood: `只输出 {"reasoning","mood":{"label","score","confidence"}} 结构不变。`,
  extract_domain_diet: `只输出 {"reasoning","diet":{...}}，meal 枚举（早餐/午餐/晚餐/加餐/夜宵/未知）与 items 结构不变。`,
  extract_domain_people: `只输出 {"reasoning","people":[{"name","event"}]} 结构不变。`,
  review_day: `输出 JSON 固定三键 summary/highlights/suggestions 及字数上限不变。`,
  review_week: `输出 JSON 固定三键 summary/highlights/suggestions 及字数上限不变。`,
  review_month: `输出 JSON 四键 summary/sections/highlights/suggestions（sections 为 {title,text} 数组）不变。`,
  review_year: `输出 JSON 四键 summary/sections/highlights/suggestions（sections 为 {title,text} 数组）不变。`,
  profile_merge: `输出 JSON 固定四键 habits/preferences/patterns/facts（字符串数组）不变。`,
  space_classify: `只输出 {"spaceId":string|null,"confidence":number}；spaceId 必须来自候选列表或 null。`,
  todo_decompose: `只输出 {"reasoning","actions":[{"title"}]}；title ≤30 字；条数上限 10。`,
  action_decompose: `只输出 {"reasoning","actions":[{"title"}]}；title ≤30 字；条数上限 3。`,
  prompt_optimizer: `本 key 是优化器元 prompt 自身：优化时必须保留"硬性规则"与"仅输出全文"的输出契约。`,
};
