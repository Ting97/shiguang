import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/todos —— 手动新增待办：只需标题，不做时间控制（due_at 留空，
 * 时间感由「无时间」标签呈现，之后仍可在待办行内编辑里补充）。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string; activityId?: string };
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "标题太长了（≤200 字）" }, { status: 400 });

  // 分类：显式指定且属于该用户则用之，否则回退「其他」；再没有就置空（前端显示 📌）
  let activityId: string | null = null;
  if (body.activityId) {
    const hit = await pool.query(`select id from activities where id = $1 and user_id = $2`, [
      body.activityId,
      user.id,
    ]);
    activityId = hit.rows[0]?.id ?? null;
  }
  if (!activityId) {
    const other = await pool.query(
      `select id from activities where user_id = $1 order by (id = 'other') desc, sort_order limit 1`,
      [user.id],
    );
    activityId = other.rows[0]?.id ?? null;
  }

  const todo = (
    await pool.query(
      `insert into todos (user_id, title, activity_id, source) values ($1, $2, $3, 'manual') returning *`,
      [user.id, title, activityId],
    )
  ).rows[0];
  return NextResponse.json({ todo });
}
