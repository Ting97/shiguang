import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { validateDebtBody, serializeDebt } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debts —— 全部负债档案（含各笔已还累计，进行中在前 → 优先级 → 创建时间） */
export const GET = withModule("debt", async (_req, { user }) => {
  const { rows } = await pool.query(
    `select l.*,
            coalesce((select sum(p.amount_cents) from liability_payments p where p.liability_id = l.id), 0)::bigint as paid_cents,
            (select count(*) from liability_payments p where p.liability_id = l.id)::int as payments_count
     from liabilities l
     where l.user_id = $1
     order by (l.status = 'active') desc, l.priority, l.created_at desc`,
    [user.id],
  );
  return NextResponse.json({ debts: rows.map(serializeDebt) });
});

/** POST /api/debts —— 新建负债档案 {name,type,principalCents,balanceCents?,ratePct?,monthlyCents?,payDay?,dueDate?,priority?,note?} */
export const POST = withModule("debt", async (req, { user }) => {
  const body = (await readJsonCapped(req) as any) as Record<string, unknown>;
  // validateDebtBody 统一抛 ApiError，无需 try/catch 兜底
  const v = validateDebtBody(body, false);
  if (v.balance_cents === undefined) v.balance_cents = v.principal_cents; // 初始余额 = 本金
  const cols = Object.keys(v);
  const created = (
    await pool.query(
      `insert into liabilities (user_id, ${cols.join(",")}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(",")}) returning *`,
      [user.id, ...cols.map((c) => v[c])],
    )
  ).rows[0];
  return NextResponse.json({ debt: serializeDebt(created) });
});
