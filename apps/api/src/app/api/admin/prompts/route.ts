import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAdmin } from "@/server/platform/http/route";
import { AI_INPUT_REGISTRY, defaultPrompt, mergeContextConfig, PROMPT_KEYS, PROMPT_META, type PromptKey } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/prompts —— prompt 清单：key 元信息 + 生效来源 + DB 覆盖内容 + 默认值全文（前端做对比）。
 * 3-A 扩展：user 模板/注入配置的 DB 覆盖原值（userTemplate/contextConfig，未覆盖为 null）、
 * 注册表全文（registry：默认模板/占位符/注入项/参数范围）——前端据此渲染三段详情。 */
export const GET = withAdmin(async () => {
  const { rows } = await pool.query(
    `select key, content, enabled, remark, updated_at, updated_by, user_template, context_config from ai_prompts`,
  );
  const overrides = new Map(rows.map((r) => [r.key, r]));
  const items = PROMPT_KEYS.map((key) => {
    const o = overrides.get(key);
    const active = o ? o.enabled : true;
    const spec = AI_INPUT_REGISTRY[key as PromptKey];
    const ctxRaw = active ? ((o?.context_config ?? null) as { inject?: Record<string, boolean>; caps?: Record<string, number> } | null) : null;
    return {
      key,
      title: PROMPT_META[key].title,
      category: PROMPT_META[key].category,
      enabled: active, // 无覆盖 = 用默认值，等效"启用"
      overridden: !!o,
      dbContent: o?.content ?? null,
      remark: o?.remark ?? null,
      updatedAt: o?.updated_at ?? null,
      defaultContent: defaultPrompt(key),
      // 3-A 输入装配：DB 覆盖原值（null=未覆盖用代码默认）+ 合并后的生效配置 + 注册表
      userTemplate: active && typeof o?.user_template === "string" && o.user_template.trim() ? o.user_template : null,
      userTemplateDefault: spec.userTemplate,
      contextConfig: ctxRaw,
      effectiveConfig: mergeContextConfig(key as PromptKey, ctxRaw),
      registry: spec,
    };
  });
  return NextResponse.json({ items });
});
