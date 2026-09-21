import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PROMPT_KEYS, invalidatePrompts, type PromptKey } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/admin/prompts/[key] —— 保存覆盖：非空 ≤50000 字；upsert + 版本快照 + 清缓存（保存即生效） */
export async function PUT(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { content, enabled = true, remark } = (await req.json().catch(() => ({}))) as {
    content?: string; enabled?: boolean; remark?: string | null;
  };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  if (content.length > 50_000) {
    return NextResponse.json({ error: `内容过长（${content.length}/50000 字）` }, { status: 400 });
  }

  const { rows } = await pool.query(
    `insert into ai_prompts (key, content, enabled, remark, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (key) do update set content = $2, enabled = $3, remark = $4, updated_by = $5, updated_at = now()
     returning key, content, enabled, remark, updated_at`,
    [key, content, enabled === true, remark ?? null, user.id],
  );
  // 版本快照（保存即留痕，供回滚）
  await pool.query(
    `insert into ai_prompt_versions (key, content, created_by) values ($1,$2,$3)`,
    [key, content, user.id],
  );
  invalidatePrompts(key as PromptKey);
  return NextResponse.json({ ok: true, prompt: rows[0] });
}

/** GET /api/admin/prompts/[key] —— 版本历史（最近 30 条，供回滚选择） */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { rows } = await pool.query(
    `select v.id, v.content, v.restored_from, v.created_at, p.nickname as created_by_name,
            length(v.content) as size
     from ai_prompt_versions v left join profiles p on p.id = v.created_by
     where v.key = $1 order by v.created_at desc limit 30`,
    [key],
  );
  return NextResponse.json({ versions: rows });
}

/** DELETE /api/admin/prompts/[key] —— 恢复代码默认值：删覆盖行 + 清缓存 */
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
