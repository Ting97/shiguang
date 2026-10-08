import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withModuleParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { validateDebtBody, serializeDebt } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/debts/[id] —— 部分更新（balance_cents 允许手工校正） */
export const PATCH = withModuleParams("debt", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const owned = await pool.query(`select id from liabilities where id = $1 and user_id = $2`, [id, user.id]);
  if (!owned.rows[0]) throw ApiError.notFound("负债不存在");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.status !== undefined) {
    if (!["active", "cleared", "archived"].includes(body.status as string)) {
      throw ApiError.badRequest("status 需为 active/cleared/archived");
    }
  }
  let v: Record<string, unknown>;
  try {
    v = validateDebtBody(body, true);
  } catch (e) {
    throw ApiError.badRequest((e as { message: string }).message);
  }
  if (body.status !== undefined) v.status = body.status;
  const cols = Object.keys(v);
  if (cols.length === 0) throw ApiError.badRequest("没有可更新的字段");
  const updated = (
    await pool.query(
      `update liabilities set ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now()
       where id = $${cols.length + 1} and user_id = $${cols.length + 2} returning *`,
      [...cols.map((c) => v[c]), id, user.id],
    )
  ).rows[0];
  return NextResponse.json({ debt: serializeDebt(updated) });
});

/** DELETE /api/debts/[id] —— 软归档（保留档案与还款历史） */
export const DELETE = withModuleParams("debt", async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const updated = (
    await pool.query(
      `update liabilities set status = 'archived', updated_at = now()
       where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!updated) throw ApiError.notFound("负债不存在");
  return NextResponse.json({ ok: true });
});
