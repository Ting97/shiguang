import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAdminParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { invalidatePrompts, PROMPT_KEYS, type PromptKey } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VersionPayload {
  system?: string;
  userTemplate?: string | null;
  contextConfig?: { inject?: Record<string, boolean>; caps?: Record<string, number> } | null;
}

/**
 * POST /api/admin/prompts/[key]/restore {versionId} —— 回滚到历史版本（记 restored_from，保存即生效）。
 * 3-A：优先取版本 payload（三件套整体回滚：system + user 模板 + 注入配置）；
 * 老版本（无 payload）仅回滚 system content，user 模板/配置保持当前覆盖不变。
 */
export const POST = withAdminParams(async (req, { user, params }) => {
  const { key } = await params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    throw ApiError.notFound("未知的 prompt key");
  }
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: number };
  if (!versionId) throw ApiError.badRequest("缺少 versionId");

  const ver = (
    await pool.query(`select id, content, payload from ai_prompt_versions where id = $1 and key = $2`, [versionId, key])
  ).rows[0];
  if (!ver) throw ApiError.notFound("版本不存在");

  const payload = (ver.payload ?? null) as VersionPayload | null;
  const content = payload?.system ?? ver.content;
  const tpl = payload ? (payload.userTemplate ?? null) : null;
  const cfg = payload ? (payload.contextConfig ?? null) : null;

  // 无 payload 的老版本：仅回滚 system，user 模板/配置保留当前覆盖
  let finalTpl: string | null = tpl;
  let finalCfg: Record<string, unknown> | null = cfg;
  if (!payload) {
    const cur = (await pool.query(`select user_template, context_config from ai_prompts where key = $1`, [key])).rows[0];
    finalTpl = (cur?.user_template as string | null) ?? null;
    finalCfg = (cur?.context_config as Record<string, unknown> | null) ?? null;
  }

  const { rows } = await pool.query(
    `insert into ai_prompts (key, content, enabled, user_template, context_config, updated_by, updated_at)
     values ($1,$2,true,$3,$4::jsonb,$5,now())
     on conflict (key) do update set content = $2, enabled = true, user_template = $3, context_config = $4::jsonb, updated_by = $5, updated_at = now()
     returning key, content, enabled, user_template, context_config, updated_at`,
    [key, content, finalTpl, finalCfg ? JSON.stringify(finalCfg) : null, user.id],
  );
  await pool.query(
    `insert into ai_prompt_versions (key, content, payload, restored_from, created_by) values ($1,$2,$3::jsonb,$4,$5)`,
    [key, content, JSON.stringify({ system: content, userTemplate: finalTpl, contextConfig: finalCfg }), ver.id, user.id],
  );
  invalidatePrompts(key as PromptKey);
  return NextResponse.json({ ok: true, prompt: rows[0] });
});
