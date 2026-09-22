import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { PROMPT_KEYS, invalidatePrompts, type PromptKey } from "@/server/ai/prompts";
import { AI_INPUT_REGISTRY, validateUserTemplate } from "@/server/ai/ai-inputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CtxConfig = { inject?: Record<string, boolean>; caps?: Record<string, number> };

/**
 * PUT /api/admin/prompts/[key] —— 保存三件套覆盖（REQ-003 3-A）：system + user 模板 + 注入配置。
 * 校验：模板占位符完整性（缺失/未知 → 400 列明）、caps 整数且在注册表范围、required 注入不可为 false。
 * 保存即生效（upsert + 清缓存）；版本快照写 payload 三件套（content 列保留兼容）。
 */
export async function PUT(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const spec = AI_INPUT_REGISTRY[key as PromptKey];
  const { content, enabled = true, remark, userTemplate, contextConfig } = (await req.json().catch(() => ({}))) as {
    content?: string; enabled?: boolean; remark?: string | null;
    userTemplate?: string | null; contextConfig?: CtxConfig | null;
  };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  if (content.length > 50_000) {
    return NextResponse.json({ error: `内容过长（${content.length}/50000 字）` }, { status: 400 });
  }

  // ---- user 模板校验（未传 = 保持原覆盖；传空串/null = 回归代码默认） ----
  let tplToSave: string | null = null;
  if (userTemplate !== undefined) {
    if (userTemplate === null || !userTemplate.trim()) {
      tplToSave = null;
    } else {
      if (userTemplate.length > 50_000) {
        return NextResponse.json({ error: `user 模板过长（${userTemplate.length}/50000 字）` }, { status: 400 });
      }
      const { missing, unknown } = validateUserTemplate(key as PromptKey, userTemplate);
      if (missing.length || unknown.length) {
        return NextResponse.json(
          {
            error: `user 模板占位符校验未通过${missing.length ? `：缺失 ${missing.map((x) => `{${x}}`).join("、")}` : ""}${unknown.length ? `：未知 ${unknown.map((x) => `{${x}}`).join("、")}` : ""}`,
            missing,
            unknown,
          },
          { status: 400 },
        );
      }
      tplToSave = userTemplate;
    }
  }

  // ---- 注入配置校验（开关仅限注册表项且 required 不可关；caps 整数且在范围内） ----
  let cfgToSave: { inject: Record<string, boolean>; caps: Record<string, number> } | null = null;
  if (contextConfig !== undefined) {
    if (contextConfig === null) {
      cfgToSave = null;
    } else {
      const inject: Record<string, boolean> = {};
      if (contextConfig.inject) {
        for (const [k, v] of Object.entries(contextConfig.inject)) {
          const def = spec.injects.find((i) => i.key === k);
          if (!def) return NextResponse.json({ error: `未知的注入项：${k}` }, { status: 400 });
          if (def.required && v === false) {
            return NextResponse.json({ error: `必需注入项「${def.label}」不可关闭` }, { status: 400 });
          }
          if (typeof v === "boolean") inject[k] = v;
        }
      }
      const caps: Record<string, number> = {};
      if (contextConfig.caps) {
        for (const [k, v] of Object.entries(contextConfig.caps)) {
          const def = spec.caps.find((c) => c.key === k);
          if (!def) return NextResponse.json({ error: `未知的参数：${k}` }, { status: 400 });
          if (typeof v !== "number" || !Number.isFinite(v) || v < def.min || v > def.max) {
            return NextResponse.json({ error: `参数「${def.label}」需为 ${def.min}~${def.max} 的数值` }, { status: 400 });
          }
          caps[k] = Math.round(v);
        }
      }
      cfgToSave = { inject, caps };
    }
  }

  // 读原覆盖（未传的字段保持原值）
  const prev = (await pool.query(`select user_template, context_config from ai_prompts where key = $1`, [key])).rows[0];
  const finalTpl = userTemplate !== undefined ? tplToSave : ((prev?.user_template as string | null) ?? null);
  const finalCfg =
    contextConfig !== undefined
      ? cfgToSave
      : ((prev?.context_config as { inject: Record<string, boolean>; caps: Record<string, number> } | null) ?? null);

  const { rows } = await pool.query(
    `insert into ai_prompts (key, content, enabled, remark, user_template, context_config, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
     on conflict (key) do update set
       content = $2, enabled = $3, remark = $4, user_template = $5, context_config = $6::jsonb, updated_by = $7, updated_at = now()
     returning key, content, enabled, remark, user_template, context_config, updated_at`,
    [key, content, enabled === true, remark ?? null, finalTpl, finalCfg ? JSON.stringify(finalCfg) : null, user.id],
  );
  // 版本快照（三件套 payload；content 列保留兼容旧版本读取）
  await pool.query(
    `insert into ai_prompt_versions (key, content, payload, created_by) values ($1,$2,$3::jsonb,$4)`,
    [key, content, JSON.stringify({ system: content, userTemplate: finalTpl, contextConfig: finalCfg }), user.id],
  );
  invalidatePrompts(key as PromptKey);
  return NextResponse.json({ ok: true, prompt: rows[0] });
}

/** GET /api/admin/prompts/[key] —— 版本历史（最近 30 条，含三件套 payload 供整体回滚） */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { rows } = await pool.query(
    `select v.id, v.content, v.payload, v.restored_from, v.created_at, p.nickname as created_by_name,
            length(v.content) as size
     from ai_prompt_versions v left join profiles p on p.id = v.created_by
     where v.key = $1 order by v.created_at desc limit 30`,
    [key],
  );
  return NextResponse.json({ versions: rows });
}

/** DELETE /api/admin/prompts/[key] —— 恢复代码默认：删覆盖行 + 清缓存 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  await pool.query(`delete from ai_prompts where key = $1`, [key]);
  invalidatePrompts(key as PromptKey);
  return NextResponse.json({ ok: true });
}
