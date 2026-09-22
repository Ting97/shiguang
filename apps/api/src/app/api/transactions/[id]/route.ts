import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** PATCH /api/transactions/:id —— 修正流水（方向/金额/类别/交易对象/账户）；{confirm:true} 草稿转正 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
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
      return NextResponse.json({ error: "金额必须为正整数（单位分）" }, { status: 400 });
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
        return NextResponse.json({ error: "账户不存在" }, { status: 400 });
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
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  vals.push(id, user.id);

  const updated = (
    await pool.query(
      `update transactions set ${sets.join(", ")}
       where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
      vals,
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "流水不存在" }, { status: 404 });
  return NextResponse.json({ transaction: updated });
}

/** DELETE /api/transactions/:id —— 删除识别错的流水 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = (
    await pool.query(
      `delete from transactions where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!deleted) return NextResponse.json({ error: "流水不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
