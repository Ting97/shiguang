import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { CONTACT_GROUPS } from "@/lib/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts/:id —— TA 的档案：基本信息 + 往来时间线 + 关联人情账 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const contact = (
    await pool.query(
      `select id, name, alias, group_tag,
              to_char(birthday, 'YYYY-MM-DD') as birthday,
              to_char(anniversary, 'YYYY-MM-DD') as anniversary,
              intimacy, importance, notes, created_at
       from contacts where id = $1 and user_id = $2`,
      [id, user.id],
    )
  ).rows[0];
  if (!contact) return NextResponse.json({ error: "联系人不存在" }, { status: 404 });

  // 一起经历过的事：往来事件（含来源动态原文与关联流水金额）
  const timeline = (
    await pool.query(
      `select i.id, i.type, i.summary, i.occurred_at, i.created_at,
              e.raw_text as entry_text,
              t.amount_cents as tx_amount_cents, t.direction as tx_direction, t.category as tx_category
         from interactions i
         left join entries e on e.id = i.entry_id
         left join transactions t on t.id = i.tx_id
        where i.contact_id = $1
        order by coalesce(i.occurred_at, i.created_at) desc
        limit 100`,
      [id],
    )
  ).rows;

  // 关联人情账：流水的「对方」字段命中联系人名（含语音/手动/导入，草稿除外）
  const money = (
    await pool.query(
      `select id, direction, amount_cents, category, note, occurred_at
         from transactions
        where user_id = $1 and counterparty = $2 and category = '人情往来' and is_draft = false
        order by occurred_at desc nulls last
        limit 50`,
      [user.id, contact.name],
    )
  ).rows;

  return NextResponse.json({ contact, timeline, money });
}

/** PATCH /api/contacts/:id —— 编辑档案 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    alias?: string | null;
    group?: string;
    birthday?: string | null;
    anniversary?: string | null;
    intimacy?: number;
    importance?: number;
    notes?: string | null;
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name?.trim()) {
    vals.push(body.name.trim());
    sets.push(`name = $${vals.length}`);
  }
  if (body.alias !== undefined) {
    vals.push(body.alias?.trim() || null);
    sets.push(`alias = $${vals.length}`);
  }
  if (body.group && (CONTACT_GROUPS as readonly string[]).includes(body.group)) {
    vals.push(body.group);
    sets.push(`group_tag = $${vals.length}`);
  }
  const date = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (body.birthday !== undefined) {
    vals.push(date(body.birthday));
    sets.push(`birthday = $${vals.length}`);
  }
  if (body.anniversary !== undefined) {
    vals.push(date(body.anniversary));
    sets.push(`anniversary = $${vals.length}`);
  }
  if (body.intimacy != null) {
    if (!Number.isInteger(body.intimacy) || body.intimacy < 0 || body.intimacy > 100) {
      return NextResponse.json({ error: "亲密度需为 0~100 整数" }, { status: 400 });
    }
    vals.push(body.intimacy);
    sets.push(`intimacy = $${vals.length}`);
  }
  if (body.importance != null) {
    if (![1, 2, 3, 4, 5].includes(body.importance)) {
      return NextResponse.json({ error: "重要程度需为 1~5 的整数" }, { status: 400 });
    }
    vals.push(body.importance);
    sets.push(`importance = $${vals.length}`);
  }
  if (body.notes !== undefined) {
    vals.push(body.notes?.trim() || null);
    sets.push(`notes = $${vals.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  vals.push(id, user.id);

  try {
    const updated = (
      await pool.query(
        `update contacts set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
        vals,
      )
    ).rows[0];
    if (!updated) return NextResponse.json({ error: "联系人不存在" }, { status: 404 });
    return NextResponse.json({ contact: updated });
  } catch (e) {
    if (String(e).includes("contacts_user_id_name_key")) {
      return NextResponse.json({ error: `已有联系人「${body.name?.trim()}」` }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/contacts/:id —— 删除联系人（往来事件级联删除，动态本体与流水不受影响） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(`delete from contacts where id = $1 and user_id = $2 returning id`, [id, user.id])
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "联系人不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
