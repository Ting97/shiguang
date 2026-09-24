import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams, type AuthedCtx } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam, optionalTrimmed } from "@/server/platform/http/validate";
import { isValidCalendarDate } from "@/server/platform/http/datetime";
import { getModuleUser } from "@/server/platform";
import { serializeDebt, serializePayment, autoCheckAfterPayment } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 带路径参数的 debt 模块门禁：等价组合 withModule("debt")（基座 withModule 不透传 params）
 * —— withAuthParams 未登录 401「未登录」；getModuleUser 为 null 即已登录未授权 → 403「未开通该模块」（admin 直通）。 */
const withDebtParams = (
  handler: (req: NextRequest, ctx: AuthedCtx & { params: Promise<any> }) => Promise<Response> | Response,
) =>
  withAuthParams(async (req, ctx) => {
    if (!(await getModuleUser("debt"))) throw new ApiError(403, "forbidden", "未开通该模块");
    return handler(req, ctx);
  });

/** POST /api/debts/[id]/payments —— 记还款 {amountCents, paidAt?, accountId?, note?}
 * 余额递减、归零自动结清；accountId 传值时联动记一笔「还款」支出并回填 tx_id；
 * 同负债同日同额重复提交 409（防双击/重试）。 */
export const POST = withDebtParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as {
    amountCents?: number;
    paidAt?: string;
    accountId?: string | null;
    note?: string | null;
  };
  if (!Number.isInteger(body.amountCents) || (body.amountCents ?? 0) <= 0) {
    throw ApiError.badRequest("还款金额需为正整数（分）");
  }
  const paidAt = body.paidAt ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  // 形状校验放行 2025-02-30 → PG date cast 500：需为真实日历日
  if (!isValidCalendarDate(paidAt)) {
    throw ApiError.badRequest("还款日期需为真实存在的 YYYY-MM-DD 日期");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // 行锁串行化并发双击：锁内（同一事务连接）先重验负债、再做防重检查——
    // 后到请求在 for update 上排队，拿到锁时前一请求已提交还款，dup 检查即命中 → 409
    const liab = (
      await client.query(`select * from liabilities where id = $1 and user_id = $2 for update`, [id, user.id])
    ).rows[0];
    if (!liab) throw ApiError.notFound("负债不存在");
    if (liab.status !== "active") {
      throw ApiError.badRequest("仅进行中的负债可记还款");
    }

    const dup = await client.query(
      `select id from liability_payments where liability_id = $1 and paid_at = $2 and amount_cents = $3`,
      [id, paidAt, body.amountCents],
    );
    if (dup.rows[0]) {
      throw ApiError.conflict("当天已有一笔相同金额的还款，请勿重复提交");
    }

    // 可选：联动资产账户记一笔支出（避免与既有记账重复时可关掉）
    let accountId: string | null = null;
    if (body.accountId) {
      assertUuidParam(body.accountId, "accountId");
      const owned = await client.query(
        `select id from accounts where id = $1 and user_id = $2 and archived = false`,
        [body.accountId, user.id],
      );
      if (!owned.rows[0]) throw ApiError.badRequest("账户不存在");
      accountId = owned.rows[0].id;
    }

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
        [user.id, id, body.amountCents, paidAt, accountId, txId, optionalTrimmed(body.note, "note") ?? null],
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
    // REQ-005 FR-3.4：记还款 ≥ 当月应还 → 自动勾选备付（幂等；事务外执行，失败不影响还款）
    void autoCheckAfterPayment(user.id, id, body.amountCents as number).catch(() => {});
    return NextResponse.json({ payment: serializePayment(payment), debt: serializeDebt(updated), transactionId: txId });
  } catch (e) {
    await client.query("rollback").catch(() => {}); // 连接已死时 rollback 自身抛错会顶替原始错误
    throw e;
  } finally {
    client.release();
  }
});

/** GET /api/debts/[id]/payments —— 还款记录（余额曲线数据源，时间升序） */
export const GET = withDebtParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const owned = await pool.query(`select id from liabilities where id = $1 and user_id = $2`, [id, user.id]);
  if (!owned.rows[0]) throw ApiError.notFound("负债不存在");
  const { rows } = await pool.query(
    `select * from liability_payments
     where liability_id = $1 and user_id = $2
     order by paid_at, created_at`,
    [id, user.id],
  );
  return NextResponse.json({ payments: rows.map(serializePayment) });
});
