import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { getModuleUser } from "@/server/platform/modules";
import { serializeDebt, serializePayment } from "@/server/finance/debt/debts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/debts/[id]/payments —— 记还款 {amountCents, paidAt?, accountId?, note?}
 * 余额递减、归零自动结清；accountId 传值时联动记一笔「还款」支出并回填 tx_id；
 * 同负债同日同额重复提交 409（防双击/重试）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getModuleUser("debt");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通负债管理模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    amountCents?: number;
    paidAt?: string;
    accountId?: string | null;
    note?: string | null;
  };
  if (!Number.isInteger(body.amountCents) || (body.amountCents ?? 0) <= 0) {
    return NextResponse.json({ error: "还款金额需为正整数（分）" }, { status: 400 });
  }
  const paidAt = body.paidAt ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return NextResponse.json({ error: "还款日期需为 YYYY-MM-DD" }, { status: 400 });
  }

  const liab = (
    await pool.query(`select * from liabilities where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!liab) return NextResponse.json({ error: "负债不存在" }, { status: 404 });
  if (liab.status !== "active") {
    return NextResponse.json({ error: "仅进行中的负债可记还款" }, { status: 400 });
  }

  const dup = await pool.query(
    `select id from liability_payments where liability_id = $1 and paid_at = $2 and amount_cents = $3`,
    [id, paidAt, body.amountCents],
  );
  if (dup.rows[0]) {
    return NextResponse.json({ error: "当天已有一笔相同金额的还款，请勿重复提交" }, { status: 409 });
  }

  // 可选：联动资产账户记一笔支出（避免与既有记账重复时可关掉）
  let accountId: string | null = null;
  if (body.accountId) {
    const owned = await pool.query(
      `select id from accounts where id = $1 and user_id = $2 and archived = false`,
      [body.accountId, user.id],
    );
    if (!owned.rows[0]) return NextResponse.json({ error: "账户不存在" }, { status: 400 });
    accountId = owned.rows[0].id;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    let txId: string | null = null;
    if (accountId) {
      const tx = (
        await client.query(
          `insert into transactions (user_id, direction, amount_cents, category, account_id, counterparty, note, occurred_at, source, is_draft)
           values ($1, 'out', $2, '还款', $3, $4, $5, $6::timestamptz, 'manual', false) returning id`,
          [
            user.id,
            body.amountCents,
            accountId,
            liab.name,
            `还款：${liab.name}`,
            `${paidAt}T12:00:00+08:00`, // 北京正午，保证 occurred_at 的北京日 = paidAt
          ],
        )
      ).rows[0];
      txId = tx.id;
    }
    const payment = (
      await client.query(
        `insert into liability_payments (user_id, liability_id, amount_cents, paid_at, account_id, tx_id, note)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [user.id, id, body.amountCents, paidAt, accountId, txId, body.note?.trim() || null],
      )
    ).rows[0];
    const updated = (
      await client.query(
        `update liabilities set
           balance_cents = greatest(0, balance_cents - $1),
           status = case when balance_cents - $1 <= 0 then 'cleared' else status end,
           updated_at = now()
         where id = $2 returning *`,
        [body.amountCents, id],
      )
    ).rows[0];
    await client.query("commit");
    return NextResponse.json({ payment: serializePayment(payment), debt: serializeDebt(updated), transactionId: txId });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

/** GET /api/debts/[id]/payments —— 还款记录（余额曲线数据源，时间升序） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getModuleUser("debt");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通负债管理模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  const { id } = await params;
  const owned = await pool.query(`select id from liabilities where id = $1 and user_id = $2`, [id, user.id]);
  if (!owned.rows[0]) return NextResponse.json({ error: "负债不存在" }, { status: 404 });
  const { rows } = await pool.query(
    `select * from liability_payments
     where liability_id = $1 and user_id = $2
     order by paid_at, created_at`,
    [id, user.id],
  );
  return NextResponse.json({ payments: rows.map(serializePayment) });
}
