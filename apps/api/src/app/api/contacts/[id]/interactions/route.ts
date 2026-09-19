import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { INTERACTION_TYPES } from "@shiguangri/shared/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/interactions —— 手动补一笔往来 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    summary?: string;
    occurredAt?: string;
  };

  const contact = (
    await pool.query(`select id from contacts where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!contact) return NextResponse.json({ error: "联系人不存在" }, { status: 404 });

  const type = (INTERACTION_TYPES as readonly string[]).includes(body.type ?? "") ? body.type! : "其他";
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "时间格式不正确" }, { status: 400 });
  }

  const created = (
    await pool.query(
      `insert into interactions (user_id, contact_id, type, summary, occurred_at)
       values ($1, $2, $3, $4, $5) returning *`,
      [user.id, id, type, body.summary?.trim() || null, occurredAt.toISOString()],
    )
  ).rows[0];
  return NextResponse.json({ interaction: created });
}
