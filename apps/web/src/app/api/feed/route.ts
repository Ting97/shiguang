import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed?limit=50 —— 动态流：entries 按记录时刻倒序，聚合 AI 识别出的日程/待办/金额/人物 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);

  const { rows } = await pool.query(
    `select e.id, e.raw_text, e.source, e.mood, e.mood_score, e.created_at,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', b.id, 'title', b.title, 'startAt', b.start_at, 'endAt', b.end_at,
           'durationMin', b.duration_min, 'activityId', b.activity_id,
           'activityName', a.name, 'icon', a.icon, 'color', a.color
         ) order by b.start_at)
         from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
         where b.entry_id = e.id
       ), '[]') as blocks,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'dueAt', t.due_at, 'status', t.status, 'activityId', t.activity_id
         ) order by t.created_at)
         from todos t where t.entry_id = e.id
       ), '[]') as todos,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', x.id, 'amountCents', x.amount_cents, 'direction', x.direction,
           'category', x.category, 'counterparty', x.counterparty
         ))
         from transactions x where x.entry_id = e.id
       ), '[]') as transactions,
       coalesce((
         select jsonb_agg(jsonb_build_object('interactionId', i.id, 'name', c.name, 'summary', i.summary))
         from interactions i join contacts c on c.id = i.contact_id
         where i.entry_id = e.id
       ), '[]') as people
     from entries e
     where e.user_id = $1
     order by e.created_at desc
     limit $2`,
    [user.id, limit],
  );
  return NextResponse.json({ moments: rows });
}
