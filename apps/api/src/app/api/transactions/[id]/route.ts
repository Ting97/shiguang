import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam, optionalTrimmed } from "@/server/platform/http/validate";
import { isParsableMoment } from "@/server/platform/http/datetime";
import { invalidateReviewCachesForOccurrence } from "@/server/insight";
import { TX_CATEGORIES } from "@shiguangri/shared/finance";

export const runtime = "nodejs";

/** PATCH /api/transactions/:id —— 修正流水（方向/金额/类别/交易对象/账户/备注/发生时间）；{confirm:true} 草稿转正 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as {
    direction?: "out" | "in";
    amountCents?: number; // 正整数（方向由 direction 决定）
    category?: string;
    counterparty?: string | null;
    accountId?: string | null;
    note?: string | null;
    occurredAt?: string;
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
    // amount_cents 为 int4 列：与 AI 契约同上限（¥100 万），巨款直落会 22003 → 500
    if (body.amountCents > 100_000_000) {
      throw ApiError.badRequest("单笔金额超出上限（¥100 万）");
    }
    vals.push(body.amountCents);
    sets.push(`amount_cents = $${vals.length}`);
  }
  // 可选字符串字段预检：非字符串原 `?.trim()` 会 TypeError → 500，统一 400
  const category = optionalTrimmed(body.category, "category");
  if (category) {
    if (!TX_CATEGORIES.includes(category)) {
      throw ApiError.badRequest("无效分类");
    }
    vals.push(category);
    sets.push(`category = $${vals.length}`);
  }
  if (body.counterparty !== undefined) {
    vals.push(optionalTrimmed(body.counterparty, "counterparty") ?? null);
    sets.push(`counterparty = $${vals.length}`);
  }
  if (body.accountId !== undefined) {
    if (body.accountId === null) {
      vals.push(null);
      sets.push(`account_id = $${vals.length}`);
    } else {
      assertUuidParam(body.accountId, "accountId");
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
  if (body.note !== undefined) {
    vals.push(optionalTrimmed(body.note, "note") ?? null);
    sets.push(`note = $${vals.length}`);
  }
  if (body.occurredAt !== undefined) {
    // 与 POST /api/transactions 同校验口径（web 编辑表单/小程序 TxForm 都发该字段，旧版被静默丢弃）：
    // 不可解析时刻拦 400，避免脏值穿透 timestamptz cast 500
    if (typeof body.occurredAt !== "string" || !isParsableMoment(body.occurredAt)) {
      throw ApiError.badRequest("时间格式不正确");
    }
    vals.push(new Date(body.occurredAt).toISOString());
    sets.push(`occurred_at = $${vals.length}`);
  }
  if (body.confirm === true) {
    vals.push(false);
    sets.push(`is_draft = $${vals.length}`);
  }
  if (sets.length === 0) {
    throw ApiError.badRequest("没有可更新的字段");
  }
  // 复盘缓存水位含 max(updated_at)（051 迁移补列）：任何编辑都抬水位，命中缓存的复盘立即失效
  sets.push(`updated_at = now()`);
  vals.push(id, user.id);

  // 跨日改 occurred_at 时旧行离开原日期区间 → 旧日期的复盘水位看不到本行（编辑等于「没发生过」），
  // 缓存被判仍新鲜回旧数据——与 DELETE 同款需按旧发生日显式失效
  const oldOccurrence = body.occurredAt
    ? (await pool.query(`select occurred_at from transactions where id = $1 and user_id = $2`, [id, user.id])).rows[0]
    : null;

  const updated = (
    await pool.query(
      `update transactions set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
      vals,
    )
  ).rows[0];
  if (!updated) throw ApiError.notFound("流水不存在");
  if (oldOccurrence) void invalidateReviewCachesForOccurrence(user.id, new Date(oldOccurrence.occurred_at));
  return NextResponse.json({ transaction: updated });
});

/** DELETE /api/transactions/:id —— 删除识别错的流水 */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  // 先取 occurred_at 再删：删除会让复盘水位（max）回退、缓存被判「仍新鲜」，需按发生日显式失效
  const row = (
    await pool.query(`delete from transactions where id = $1 and user_id = $2 returning id, occurred_at`, [
      id, user.id,
    ])
  ).rows[0];
  if (!row) throw ApiError.notFound("流水不存在");
  void invalidateReviewCachesForOccurrence(user.id, new Date(row.occurred_at));
  return NextResponse.json({ ok: true });
});
