import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { getModuleUser } from "@/server/platform/modules";
import { validateDebtBody, serializeDebt } from "@/server/finance/debt/debts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATE = async (): Promise<
  { user: null; res: NextResponse } | { user: NonNullable<Awaited<ReturnType<typeof getModuleUser>>>; res: null }
> => {
  const user = await getModuleUser("debt");
  if (!user) {
    const cur = await getCurrentUser();
    return { user: null, res: NextResponse.json({ error: cur ? "未开通负债管理模块" : "未登录" }, { status: cur ? 403 : 401 }) };
  }
  return { user, res: null };
};

/** PATCH /api/debts/[id] —— 部分更新（balance_cents 允许手工校正） */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, res } = await GATE();
  if (!user) return res;
  const { id } = await params;
  const owned = await pool.query(`select id from liabilities where id = $1 and user_id = $2`, [id, user.id]);
  if (!owned.rows[0]) return NextResponse.json({ error: "负债不存在" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.status !== undefined) {
    if (!["active", "cleared", "archived"].includes(body.status as string)) {
      return NextResponse.json({ error: "status 需为 active/cleared/archived" }, { status: 400 });
    }
  }
  let v: Record<string, unknown>;
  try {
    v = validateDebtBody(body, true);
  } catch (e) {
    return NextResponse.json({ error: (e as { message: string }).message }, { status: 400 });
  }
  if (body.status !== undefined) v.status = body.status;
  const cols = Object.keys(v);
  if (cols.length === 0) return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  const updated = (
    await pool.query(
      `update liabilities set ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now()
       where id = $${cols.length + 1} and user_id = $${cols.length + 2} returning *`,
      [...cols.map((c) => v[c]), id, user.id],
    )
  ).rows[0];
  return NextResponse.json({ debt: serializeDebt(updated) });
}

/** DELETE /api/debts/[id] —— 软归档（保留档案与还款历史） */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, res } = await GATE();
  if (!user) return res;
  const { id } = await params;
  const updated = (
    await pool.query(
      `update liabilities set status = 'archived', updated_at = now()
       where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "负债不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
