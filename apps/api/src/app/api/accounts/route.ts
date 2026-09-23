import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/accounts —— 全部账户（含动态余额 + 备付参与标记；camelCase 规范字段，snake_case 旧别名兼容一版） */
export const GET = withAuth(async (_req, { user }) => {
  const { rows } = await pool.query(
    `select x.id, x.name, x.icon, x.sort_order,
            x.opening_balance_cents, x.opening_balance_cents as "openingBalanceCents",
            x.balance_cents, x.balance_cents as "balanceCents",
            coalesce(x.reserve_tracked, false) as "reserveTracked"
     from (
       select a.id, a.name, a.icon, a.sort_order, a.created_at, a.opening_balance_cents, a.reserve_tracked,
              (a.opening_balance_cents + coalesce((
                 select sum(case when t.direction = 'out' then -t.amount_cents else t.amount_cents end)
                 from transactions t
                 where t.account_id = a.id and t.is_draft = false
               ), 0))::bigint as balance_cents
       from accounts a
       where a.user_id = $1 and a.archived = false
     ) x
     order by x.sort_order, x.created_at`,
    [user.id],
  );
  // ::bigint 防 int4 溢出，但 node-pg 对 bigint 返回 string：序列化统一 Number()，响应类型不变
  const accounts = rows.map((r) => ({ ...r, balance_cents: Number(r.balance_cents), balanceCents: Number(r.balanceCents) }));
  return NextResponse.json({ accounts });
});

/** POST /api/accounts —— 新建账户 {name, icon?, openingBalanceCents?} */
export const POST = withAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    openingBalanceCents?: number;
  };
  const name = body.name?.trim();
  if (!name) throw ApiError.badRequest("账户名称必填");
  if (name.length > 20) throw ApiError.badRequest("账户名称过长");
  const opening = body.openingBalanceCents ?? 0;
  if (!Number.isInteger(opening)) throw ApiError.badRequest("期初余额需为整数（分）");

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
      throw ApiError.badRequest("已存在同名账户");
    }
    throw e;
  }
});
