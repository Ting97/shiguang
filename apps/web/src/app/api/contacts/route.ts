import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { CONTACT_GROUPS } from "@/lib/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts —— 联系人列表（含互动次数/最近往来/人情往来净额） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { rows } = await pool.query(
    `select c.id, c.name, c.alias, c.group_tag,
            to_char(c.birthday, 'YYYY-MM-DD') as birthday,
            to_char(c.anniversary, 'YYYY-MM-DD') as anniversary,
            c.intimacy, c.notes, c.created_at,
            (select count(*) from interactions i where i.contact_id = c.id) as interaction_count,
            (select i.occurred_at from interactions i where i.contact_id = c.id
              order by i.occurred_at desc nulls last limit 1) as last_at,
            (select i.summary from interactions i where i.contact_id = c.id
              order by i.occurred_at desc nulls last limit 1) as last_summary,
            (select coalesce(sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end), 0)
               from transactions t
              where t.user_id = c.user_id and t.counterparty = c.name
                and t.category = '人情往来' and t.is_draft = false) as gift_net_cents
       from contacts c
      where c.user_id = $1
      order by last_at desc nulls last, c.created_at desc`,
    [user.id],
  );
  return NextResponse.json({ contacts: rows });
}

/** POST /api/contacts —— 手动建档 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    alias?: string | null;
    group?: string;
    birthday?: string | null;
    anniversary?: string | null;
    notes?: string | null;
  };

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "姓名必填" }, { status: 400 });
  if (name.length > 30) return NextResponse.json({ error: "姓名过长" }, { status: 400 });
  const group = body.group && (CONTACT_GROUPS as readonly string[]).includes(body.group) ? body.group : "朋友";
  const date = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

  try {
    const created = (
      await pool.query(
        `insert into contacts (user_id, name, alias, group_tag, birthday, anniversary, notes)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [user.id, name, body.alias?.trim() || null, group, date(body.birthday), date(body.anniversary), body.notes?.trim() || null],
      )
    ).rows[0];
    return NextResponse.json({ contact: created });
  } catch (e) {
    if (String(e).includes("contacts_user_id_name_key")) {
      return NextResponse.json({ error: `已有联系人「${name}」` }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
