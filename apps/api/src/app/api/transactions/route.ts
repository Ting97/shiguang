import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { TX_CATEGORIES } from "@shiguangri/shared/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";

/** GET /api/transactions?month=YYYY-MM&status=all|draft|confirmed —— 月度流水列表 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const status = url.searchParams.get("status") ?? "all";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month 需为 YYYY-MM" }, { status: 400 });
  }
  const draftCond =
    status === "draft" ? " and t.is_draft = true" : status === "confirmed" ? " and t.is_draft = false" : "";

  const { rows } = await pool.query(
    `select t.id, t.direction, t.amount_cents, t.category, t.counterparty, t.note,
            t.occurred_at, t.is_draft, t.source, t.entry_id, t.account_id,
            a.name as account_name, a.icon as account_icon
     from transactions t
     left join accounts a on a.id = t.account_id
     where t.user_id = $1${draftCond}
       and to_char(t.occurred_at at time zone $2, 'YYYY-MM') = $3
     order by t.occurred_at desc, t.created_at desc`,
    [user.id, TZ, month],
  );
  return NextResponse.json({ transactions: rows });
}

/** POST /api/transactions —— 手动记账（直接为已确认流水） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    direction?: "out" | "in";
    amountCents?: number;
    category?: string;
    accountId?: string | null;
    occurredAt?: string;
    note?: string | null;
    counterparty?: string | null;
  };

  if (body.direction !== "out" && body.direction !== "in") {
    return NextResponse.json({ error: "方向需为 out/in" }, { status: 400 });
  }
  if (!Number.isInteger(body.amountCents) || (body.amountCents ?? 0) <= 0) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }
  const category = body.category?.trim() || "其他";
  if (!TX_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "无效分类" }, { status: 400 });
  }
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "时间格式不正确" }, { status: 400 });
  }

  // 账户归属校验（只能挂自己的账户）
  let accountId: string | null = null;
  if (body.accountId) {
    const owned = await pool.query(
      `select id from accounts where id = $1 and user_id = $2 and archived = false`,
      [body.accountId, user.id],
    );
    if (owned.rows.length === 0) {
      return NextResponse.json({ error: "账户不存在" }, { status: 400 });
    }
    accountId = owned.rows[0].id;
  }

  const created = (
    await pool.query(
      `insert into transactions (user_id, direction, amount_cents, category, account_id, counterparty, note, occurred_at, source, is_draft)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', false) returning *`,
      [
        user.id,
        body.direction,
        body.amountCents,
        category,
        accountId,
        body.counterparty?.trim() || null,
        body.note?.trim() || null,
        occurredAt.toISOString(),
      ],
    )
  ).rows[0];
  return NextResponse.json({ transaction: created });
}
