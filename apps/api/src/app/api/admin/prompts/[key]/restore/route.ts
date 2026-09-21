import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PROMPT_KEYS, invalidatePrompts, type PromptKey } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/prompts/[key]/restore {versionId} —— 回滚到历史版本（记 restored_from，保存即生效） */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: number };
  if (!versionId) return NextResponse.json({ error: "缺少 versionId" }, { status: 400 });

  const ver = (
    await pool.query(`select id, content from ai_prompt_versions where id = $1 and key = $2`, [versionId, key])
  ).rows[0];
  if (!ver) return NextResponse.json({ error: "版本不存在" }, { status: 404 });

  const { rows } = await pool.query(
    `insert into ai_prompts (key, content, enabled, updated_by, updated_at)
     values ($1,$2,true,$3,now())
     on conflict (key) do update set content = $2, enabled = true, updated_by = $3, updated_at = now()
     returning key, content, enabled, updated_at`,
    [key, ver.content, user.id],
  );
  await pool.query(
    `insert into ai_prompt_versions (key, content, restored_from, created_by) values ($1,$2,$3,$4)`,
    [key, ver.content, ver.id, user.id],
  );
  invalidatePrompts(key as PromptKey);
  return NextResponse.json({ ok: true, prompt: rows[0] });
}
