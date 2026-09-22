import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";

export const runtime = "nodejs";

/** PATCH /api/transactions/:id —— 修正流水（方向/金额/类别/交易对象/账户）；{confirm:true} 草稿转正 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    direction?: "out" | "in";
    amountCents?: number; // 正整数（方向由 direction 决定）
    category?: string;
    counterparty?: string | null;
    accountId?: string | null;
    confirm?: boolean; // 草稿 → 已确认入账
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.direction === "out" || body.direction === "in") {
    vals.push(body.direction);
    sets.push(`direction = $${vals.length}`);
  }
  if (body.amountCents != null) {
    if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
      throw ApiError.badRequest("金额必须为正整数（单位分）");
    }
    vals.push(body.amountCents);
    sets.push(`amount_cents = $${vals.length}`);
  }
  if (body.category?.trim()) {
    vals.push(body.category.trim());
    sets.push(`category = $${vals.length}`);
  }
  if (body.counterparty !== undefined) {
    vals.push(body.counterparty?.trim() || null);
    sets.push(`counterparty = $${vals.length}`);
  }
  if (body.accountId !== undefined) {
    if (body.accountId === null) {
      vals.push(null);
      sets.push(`account_id = $${vals.length}`);
    } else {
      const owned = await pool.query(
        `select id from accounts where id = $1 and user_id = $2 and archived = false`,
        [body.accountId, user.id],
      );
      if (owned.rows.length === 0) {
        throw ApiError.badRequest("账户不存在");
      }
      vals.push(body.accountId);
      sets.push(`account_id = $${vals.length}`);
    }
  }
  if (body.confirm === true) {
    vals.push(false);
    sets.push(`is_draft = $${vals.length}`);
  }
  if (sets.length === 0) {
    throw ApiError.badRequest("没有可更新的字段");
  }
  vals.push(id, user.id);

  const updated = (
    await pool.query(
      `update transactions set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
      vals,
    )
  ).rows[0];
  if (!updated) throw ApiError.notFound("流水不存在");
  return NextResponse.json({ transaction: updated });
});

/** DELETE /api/transactions/:id —— 删除识别错的流水 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  const deleted = (
    await pool.query(
      `delete from transactions where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!deleted) throw ApiError.notFound("流水不存在");
  return NextResponse.json({ ok: true });
});
