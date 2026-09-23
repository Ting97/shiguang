import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";

export const runtime = "nodejs";

/** PATCH /api/accounts/:id —— 改名/图标/期初余额/排序/归档 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    openingBalanceCents?: number;
    archived?: boolean;
    reserveTracked?: boolean; // REQ-005 FR-3.3：参与备付覆盖统计
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name?.trim()) {
    vals.push(body.name.trim());
    sets.push(`name = $${vals.length}`);
  }
  if (body.icon?.trim()) {
    vals.push(body.icon.trim());
    sets.push(`icon = $${vals.length}`);
  }
  if (body.openingBalanceCents != null) {
    if (!Number.isInteger(body.openingBalanceCents)) {
      throw ApiError.badRequest("期初余额需为整数（分）");
    }
    vals.push(body.openingBalanceCents);
    sets.push(`opening_balance_cents = $${vals.length}`);
  }
  if (body.archived != null) {
    vals.push(body.archived);
    sets.push(`archived = $${vals.length}`);
  }
  if (body.reserveTracked != null) {
    vals.push(body.reserveTracked);
    sets.push(`reserve_tracked = $${vals.length}`);
  }
  if (sets.length === 0) throw ApiError.badRequest("没有可更新的字段");
  vals.push(id, user.id);

  try {
    const updated = (
      await pool.query(
        `update accounts set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
        vals,
      )
    ).rows[0];
    if (!updated) throw ApiError.notFound("账户不存在");
    return NextResponse.json({ account: updated });
  } catch (e) {
    if (String(e).includes("accounts_user_id_name_key")) {
      throw ApiError.badRequest("已存在同名账户");
    }
    throw e;
  }
});

/** DELETE /api/accounts/:id —— 归档账户（不物理删除，历史流水完整保留） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  const updated = (
    await pool.query(
      `update accounts set archived = true where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!updated) throw ApiError.notFound("账户不存在");
  return NextResponse.json({ ok: true });
});
