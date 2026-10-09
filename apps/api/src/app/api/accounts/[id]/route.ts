import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";

export const runtime = "nodejs";

/** PATCH /api/accounts/:id —— 改名/图标/期初余额/排序/归档 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    openingBalanceCents?: number;
    archived?: boolean;
    reserveTracked?: boolean; // REQ-005 FR-3.3：参与备付覆盖统计
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  // 非字符串直落 .trim() 是 TypeError → 500（与 POST 通道同批守卫）
  if (body.name != null && typeof body.name !== "string") throw ApiError.badRequest("账户名称需为字符串");
  if (body.icon != null && typeof body.icon !== "string") throw ApiError.badRequest("图标需为字符串");
  if (body.name?.trim()) {
    vals.push(body.name.trim());
    sets.push(`name = $${vals.length}`);
  }
  if (body.icon?.trim()) {
    vals.push(body.icon.trim());
    sets.push(`icon = $${vals.length}`);
  }
  if (body.openingBalanceCents != null) {
    // 上限对齐 transactions（¥100 万）：bigint 列吃 1e21 → pg 序列化 "1e+21" → 22P02 → 500
    if (!Number.isInteger(body.openingBalanceCents) || Math.abs(body.openingBalanceCents) > 100_000_000) {
      throw ApiError.badRequest("期初余额需为整数（分），不超过 ¥100 万");
    }
    vals.push(body.openingBalanceCents);
    sets.push(`opening_balance_cents = $${vals.length}`);
  }
  if (body.archived != null) {
    // 恢复守卫：归档期名字已释放，可能已被同名新账户占用——恢复前先查重，撞名 400 而非 23505 裸 500
    if (body.archived === false) {
      const self = await pool.query(`select name from accounts where id = $1 and user_id = $2`, [id, user.id]);
      const name = self.rows[0]?.name;
      if (name) {
        const clash = await pool.query(
          `select 1 from accounts where user_id = $1 and name = $2 and archived = false and id <> $3`,
          [user.id, name, id],
        );
        if (clash.rows[0]) throw ApiError.badRequest(`无法恢复：已存在同名未归档账户「${name}」`);
      }
    }
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
    // 050 起唯一约束是部分索引（仅未归档行），违例报索引名；兼容旧约束名
    if (String(e).includes("accounts_user_id_name_key") || String(e).includes("accounts_user_id_name_active_uidx")) {
      throw ApiError.badRequest("已存在同名账户");
    }
    throw e;
  }
});

/** DELETE /api/accounts/:id —— 归档账户（不物理删除，历史流水完整保留） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const updated = (
    await pool.query(
      `update accounts set archived = true where id = $1 and user_id = $2 returning id`,
      [id, user.id],
    )
  ).rows[0];
  if (!updated) throw ApiError.notFound("账户不存在");
  return NextResponse.json({ ok: true });
});
