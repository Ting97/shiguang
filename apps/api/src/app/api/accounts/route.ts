import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/accounts —— 全部账户（含动态余额） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows } = await pool.query(
    `select a.id, a.name, a.icon, a.sort_order, a.opening_balance_cents,
            (a.opening_balance_cents + coalesce((
               select sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end)
               from transactions t
               where t.account_id = a.id and t.is_draft = false
             ), 0))::int as balance_cents
     from accounts a
     where a.user_id = $1 and a.archived = false
     order by a.sort_order, a.created_at`,
    [user.id],
  );
  return NextResponse.json({ accounts: rows });
}

/** POST /api/accounts —— 新建账户 {name, icon?, openingBalanceCents?} */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    openingBalanceCents?: number;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "账户名称必填" }, { status: 400 });
  if (name.length > 20) return NextResponse.json({ error: "账户名称过长" }, { status: 400 });
  const opening = body.openingBalanceCents ?? 0;
  if (!Number.isInteger(opening)) return NextResponse.json({ error: "期初余额需为整数（分）" }, { status: 400 });

  try {
    const created = (
      await pool.query(
        `insert into accounts (user_id, name, icon, opening_balance_cents, sort_order)
         values ($1, $2, $3, $4, (select coalesce(max(sort_order), 0) + 1 from accounts where user_id = $1))
         returning *`,
        [user.id, name, body.icon?.trim() || "💳", opening],
      )
    ).rows[0];
    return NextResponse.json({ account: created });
  } catch (e) {
    if (String(e).includes("accounts_user_id_name_key")) {
      return NextResponse.json({ error: "已存在同名账户" }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
