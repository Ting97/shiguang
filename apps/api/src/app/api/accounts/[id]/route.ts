import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** PATCH /api/accounts/:id —— 改名/图标/期初余额/排序/归档 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    openingBalanceCents?: number;
    archived?: boolean;
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
      return NextResponse.json({ error: "期初余额需为整数（分）" }, { status: 400 });
    }
    vals.push(body.openingBalanceCents);
    sets.push(`opening_balance_cents = $${vals.length}`);
  }
  if (body.archived != null) {
    vals.push(body.archived);
    sets.push(`archived = $${vals.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  vals.push(id, user.id);

  try {
    const updated = (
      await pool.query(
        `update accounts set ${sets.join(", ")}
         where id = $${vals.length - 1} and user_id = $${vals.length} returning *`,
        vals,
      )
    ).rows[0];
    if (!updated) return NextResponse.json({ error: "账户不存在" }, { status: 404 });
    return NextResponse.json({ account: updated });
  } catch (e) {
    if (String(e).includes("accounts_user_id_name_key")) {
      return NextResponse.json({ error: "已存在同名账户" }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/accounts/:id —— 归档账户（不物理删除，历史流水完整保留） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const updated = (
    await pool.query(
      `update accounts set archived = true where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!updated) return NextResponse.json({ error: "账户不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
