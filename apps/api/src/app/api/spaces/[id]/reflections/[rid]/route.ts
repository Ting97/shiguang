import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 50_000;

/** 归属校验：感悟 → 空间 → 用户 一条 JOIN 判定 */
async function ownReflection(rid: string, userId: string) {
  const { rows } = await pool.query(
    `select r.id from space_reflections r
     join goal_spaces s on s.id = r.space_id
     where r.id = $1 and s.user_id = $2`,
    [rid, userId],
  );
  return rows[0] ?? null;
}

/** GET /api/spaces/:id/reflections/:rid —— 全文（编辑/展开时拉取） */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rid } = await ctx.params;
  if (!(await ownReflection(rid, user.id))) return NextResponse.json({ error: "感悟不存在" }, { status: 404 });

  const { rows } = await pool.query(
    `select id, content, created_at, updated_at from space_reflections where id = $1`,
    [rid],
  );
  return NextResponse.json({ reflection: rows[0] });
}

/** PATCH /api/spaces/:id/reflections/:rid —— 编辑 { content }；updated_at=now()（列表据此刻画"已编辑"） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rid } = await ctx.params;
  if (!(await ownReflection(rid, user.id))) return NextResponse.json({ error: "感悟不存在" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "感悟不能为空" }, { status: 400 });
  if (content.length > MAX_CHARS) return NextResponse.json({ error: "超出 50000 字上限" }, { status: 400 });

  const { rows } = await pool.query(
    `update space_reflections set content = $1, updated_at = now() where id = $2 returning id, content, created_at, updated_at`,
    [content, rid],
  );
  return NextResponse.json({ reflection: rows[0] });
}

/** DELETE /api/spaces/:id/reflections/:rid —— 硬删 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rid } = await ctx.params;
  if (!(await ownReflection(rid, user.id))) return NextResponse.json({ error: "感悟不存在" }, { status: 404 });

  await pool.query(`delete from space_reflections where id = $1`, [rid]);
  return NextResponse.json({ ok: true });
}
