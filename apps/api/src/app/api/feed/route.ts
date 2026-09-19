import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/feed?limit=10&offset=0&q=关键字
 * 动态流：entries 按记录时刻倒序，聚合 AI 识别出的日程/待办/金额/人物/饮食/识别登记簿。
 * q 非空时按关键字检索：原文 + 识别产物（日程/待办标题、交易类别与对方、联系人、饮食条目）。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10), 1), 200);
  const offset = Math.min(Math.max(Number(url.searchParams.get("offset") ?? 0), 0), 100_000);
  const q = (url.searchParams.get("q") ?? "").trim();

  // 关键字检索：动态原文命中，或任一识别产物命中（中英文均可，ilike 不区分大小写）
  const searchSql = q
    ? `and (
         e.raw_text ilike $4
         or exists (select 1 from time_blocks b where b.entry_id = e.id and b.title ilike $4)
         or exists (select 1 from todos t where t.entry_id = e.id and t.title ilike $4)
         or exists (select 1 from transactions x where x.entry_id = e.id
                    and (x.category ilike $4 or x.counterparty ilike $4 or x.note ilike $4))
         or exists (select 1 from interactions i join contacts c on c.id = i.contact_id
                    where i.entry_id = e.id and c.name ilike $4)
         or exists (select 1 from diet_records d where d.entry_id = e.id and d.items::text ilike $4)
       )`
    : "";

  const { rows } = await pool.query(
    `select e.id, e.raw_text, e.source, e.mood, e.mood_score, e.created_at, e.analyzed_at,
       count(*) over () as total_count,
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
       ), '[]') as people,
       (select jsonb_build_object('id', d.id, 'meal', d.meal, 'items', d.items, 'totalKcal', d.total_kcal)
         from diet_records d where d.entry_id = e.id) as diet,
       coalesce((
         select jsonb_object_agg(rg.domain, jsonb_build_object(
           'status', rg.status, 'confidence', rg.confidence, 'reason', rg.result->>'reason'))
         from entry_recognitions rg where rg.entry_id = e.id
       ), '{}'::jsonb) as recognitions
     from entries e
     where e.user_id = $1 ${searchSql}
     order by e.created_at desc
     limit $2 offset $3`,
    // 转义 ilike 通配符，避免用户输入的 % _ 被当模糊匹配
    q ? [user.id, limit, offset, `%${q.replace(/[\\%_]/g, "\\$&")}%`] : [user.id, limit, offset],
  );
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return NextResponse.json({ moments: rows, total });
}
