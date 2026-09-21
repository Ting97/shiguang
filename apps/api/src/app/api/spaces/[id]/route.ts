import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/spaces/:id —— 字段修改 + {status:'archived'|'active'} 归档/恢复 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const { name, description, icon, color, startedAt, targetDate, status, sort } = (await req.json().catch(() => ({}))) as {
    name?: string; description?: string | null; icon?: string; color?: string;
    startedAt?: string | null; targetDate?: string | null; status?: string; sort?: number;
  };
  if (status !== undefined && status !== "active" && status !== "archived") {
    return NextResponse.json({ error: "status 需为 active/archived" }, { status: 400 });
  }
  if (name !== undefined && (!name.trim() || name.trim().length > 40)) {
    return NextResponse.json({ error: "名称必填且不超过 40 字" }, { status: 400 });
  }
  const dateOr = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  // 提供=有值才更新，避免"未传字段"与"清空字段"混淆（前端编辑器每次全量传）
  const { rows } = await pool.query(
    `update goal_spaces set
       name = coalesce($2, name),
       description = case when $3 then $4 else description end,
       icon = coalesce($5, icon),
       color = coalesce($6, color),
       started_at = case when $7 then $8 else started_at end,
       target_date = case when $9 then $10 else target_date end,
       status = coalesce($11, status),
       sort = coalesce($12, sort),
       updated_at = now()
     where id = $1 and user_id = $13 returning *`,
    [
      id,
      name?.trim() ?? null,
      description !== undefined, description?.trim() || null,
      icon?.trim() || null,
      color ?? null,
      startedAt !== undefined, dateOr(startedAt),
      targetDate !== undefined, dateOr(targetDate),
      status ?? null,
      sort ?? null,
      user.id,
    ],
  );
  if (!rows[0]) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, space: rows[0] });
}

/** DELETE /api/spaces/:id —— 硬删空间；entries/todos.space_id 由外键 on delete set null 兜底，业务数据完好 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const { rowCount } = await pool.query(`delete from goal_spaces where id = $1 and user_id = $2`, [id, user.id]);
  if (!rowCount) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
