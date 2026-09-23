import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams, type AuthedCtx } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { getModuleUser } from "@/server/platform";
import { validateDebtBody, serializeDebt } from "@/server/finance";

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

/** PATCH /api/debts/[id] —— 部分更新（balance_cents 允许手工校正） */
export const PATCH = withDebtParams(async (req, { user, params }) => {
  const { id } = await params;
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
export const DELETE = withDebtParams(async (_req, { user, params }) => {
  const { id } = await params;
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
