import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACTIVE_SPACES = 20;

/**
 * GET /api/spaces —— 空间列表（active 在前）+ 聚合统计：
 * todoTotal/todoDone（顶层待办）、actionTotal/actionDone（行动=子待办）、entryCount
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows } = await pool.query(
    `select s.*,
            coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is null), 0) as todo_total,
            coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is null and t.status = 'done'), 0) as todo_done,
            coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is not null), 0) as action_total,
            coalesce((select count(*)::int from todos t where t.space_id = s.id and t.parent_todo_id is not null and t.status = 'done'), 0) as action_done,
            coalesce((select count(*)::int from entries e where e.space_id = s.id), 0) as entry_count
     from goal_spaces s
     where s.user_id = $1
     order by (s.status = 'active') desc, s.sort, s.created_at`,
    [user.id],
  );
  return NextResponse.json({ spaces: rows });
}

/** POST /api/spaces —— 创建空间；active 超过 20 个时 400（控制 AI 分类 prompt 长度与认知负担） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { name, description, icon, color, startedAt, targetDate } = (await req.json().catch(() => ({}))) as {
    name?: string; description?: string; icon?: string; color?: string; startedAt?: string; targetDate?: string;
  };
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.length > 40) {
    return NextResponse.json({ error: "名称必填且不超过 40 字" }, { status: 400 });
  }
  const { rows: active } = await pool.query(
    `select count(*)::int as n from goal_spaces where user_id = $1 and status = 'active'`,
    [user.id],
  );
  if (active[0].n >= MAX_ACTIVE_SPACES) {
    return NextResponse.json({ error: `进行中的空间已达 ${MAX_ACTIVE_SPACES} 个，请先归档` }, { status: 400 });
  }
  const started = startedAt && /^\d{4}-\d{2}-\d{2}$/.test(startedAt) ? startedAt : null;
  const target = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null;
  const { rows } = await pool.query(
    `insert into goal_spaces (user_id, name, description, icon, color, started_at, target_date)
     values ($1,$2,$3,coalesce($4,'🎯'),coalesce($5,'#38bdf8'),$6,$7) returning *`,
    [user.id, trimmed, description?.trim() || null, icon?.trim() || null, color ?? null, started, target],
  );
  return NextResponse.json({ ok: true, space: rows[0] });
}
