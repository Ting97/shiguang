import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PROMPT_KEYS, PROMPT_META, defaultPrompt, type PromptKey } from "@/lib/prompts";
import { AI_INPUT_REGISTRY, mergeContextConfig } from "@/lib/ai-inputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/prompts —— prompt 清单：key 元信息 + 生效来源 + DB 覆盖内容 + 默认值全文（前端做对比）。
 * 3-A 扩展：user 模板/注入配置的 DB 覆盖原值（userTemplate/contextConfig，未覆盖为 null）、
 * 注册表全文（registry：默认模板/占位符/注入项/参数范围）——前端据此渲染三段详情。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

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
}
