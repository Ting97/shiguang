import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { CONTACT_GROUPS } from "@shiguangri/shared/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts —— 联系人列表（含互动次数/最近往来/人情往来净额） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { rows } = await pool.query(
    `select c.id, c.name, c.alias, c.group_tag,
            to_char(c.birthday, 'YYYY-MM-DD') as birthday,
            c.birthday_cal, c.lunar_month, c.lunar_day, c.lunar_leap,
            to_char(c.anniversary, 'YYYY-MM-DD') as anniversary,
            c.intimacy, c.importance, c.notes, c.created_at,
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
    birthdayCal?: "solar" | "lunar";
    lunarMonth?: number;
    lunarDay?: number;
    lunarLeap?: boolean;
    anniversary?: string | null;
    importance?: number;
    notes?: string | null;
  };

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "姓名必填" }, { status: 400 });
  if (name.length > 30) return NextResponse.json({ error: "姓名过长" }, { status: 400 });
  const group = body.group && (CONTACT_GROUPS as readonly string[]).includes(body.group) ? body.group : "朋友";
  const importance = [1, 2, 3, 4, 5].includes(body.importance as number) ? (body.importance as number) : 3;
  const date = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

  // 生日历法：农历存 lunar_*（birthday 置空），阳历存 birthday
  const isLunar = body.birthdayCal === "lunar";
  const lunarMonth = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(body.lunarMonth as number) ? (body.lunarMonth as number) : null;
  const lunarDay = body.lunarDay != null && body.lunarDay >= 1 && body.lunarDay <= 30 ? (body.lunarDay as number) : null;
  if (isLunar && (!lunarMonth || !lunarDay)) {
    return NextResponse.json({ error: "农历生日需选择月和日" }, { status: 400 });
  }

  try {
    // with ins 返回：birthday/anniversary 用 to_char 转字符串，防 pg date 被序列化成 UTC ISO 退一天
    const created = (
      await pool.query(
        `with ins as (
           insert into contacts (user_id, name, alias, group_tag, birthday, birthday_cal, lunar_month, lunar_day, lunar_leap, anniversary, importance, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning *
         )
         select ins.*, to_char(ins.birthday, 'YYYY-MM-DD') as birthday,
                to_char(ins.anniversary, 'YYYY-MM-DD') as anniversary
         from ins`,
        [
          user.id,
          name,
          body.alias?.trim() || null,
          group,
          isLunar ? null : date(body.birthday),
          isLunar ? "lunar" : "solar",
          isLunar ? lunarMonth : null,
          isLunar ? lunarDay : null,
          isLunar ? !!body.lunarLeap : false,
          date(body.anniversary),
          importance,
          body.notes?.trim() || null,
        ],
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
