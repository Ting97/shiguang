import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 50_000;

/** GET /api/spaces/:id/reflections?limit=20&offset=0 —— 感悟列表（倒序；只回预览 300 字 + 字数，长列表性能） */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const own = await pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [id, user.id]);
  if (!own.rows[0]) return NextResponse.json({ error: "空间不存在" }, { status: 404 });

  const { rows } = await pool.query(
    `select id,
            left(content, 300) as preview,
            char_length(content)::int as chars,
            created_at, updated_at,
            (updated_at > created_at) as edited
     from space_reflections
     where space_id = $1
     order by created_at desc
     limit $2 offset $3`,
    [id, limit, offset],
  );
  const total = (
    await pool.query(`select count(*)::int as n from space_reflections where space_id = $1`, [id])
  ).rows[0].n;

  return NextResponse.json({ items: rows, total });
}

/** POST /api/spaces/:id/reflections —— 新建感悟 { content } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "感悟不能为空" }, { status: 400 });
  if (content.length > MAX_CHARS) return NextResponse.json({ error: "超出 50000 字上限" }, { status: 400 });

  const own = await pool.query(`select id from goal_spaces where id = $1 and user_id = $2`, [id, user.id]);
  if (!own.rows[0]) return NextResponse.json({ error: "空间不存在" }, { status: 404 });

  const { rows } = await pool.query(
    `insert into space_reflections (user_id, space_id, content) values ($1, $2, $3) returning *`,
    [user.id, id, content],
  );
  return NextResponse.json({ reflection: rows[0] }, { status: 201 });
}
