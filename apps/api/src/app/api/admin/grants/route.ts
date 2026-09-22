import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getAdminUser, getCurrentUser } from "@/lib/auth";
import { MODULES, listUserModules } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID = new Set<string>(MODULES);

/** GET /api/admin/grants —— 全部用户的模块授权矩阵（叠加 billing/users 的用户列表用） */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    const user = await getCurrentUser();
    return NextResponse.json({ error: user ? "仅管理员" : "未登录" }, { status: user ? 403 : 401 });
  }
  const { rows } = await pool.query(
    `select user_id, module, granted_by, granted_at from user_module_grants order by granted_at desc`,
  );
  return NextResponse.json({ grants: rows });
}

/** POST /api/admin/grants {userId, module} —— 授权（幂等） */
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    const user = await getCurrentUser();
    return NextResponse.json({ error: user ? "仅管理员" : "未登录" }, { status: user ? 403 : 401 });
  }
  const { userId, module } = (await req.json().catch(() => ({}))) as {
    userId?: string;
    module?: string;
  };
  if (!userId || !module || !VALID.has(module)) {
    return NextResponse.json({ error: "userId 与 module（debt/trade_review）必填" }, { status: 400 });
  }
  const exists = await pool.query(`select 1 from profiles where id = $1`, [userId]);
  if (!exists.rows[0]) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  await pool.query(
    `insert into user_module_grants (user_id, module, granted_by)
     values ($1,$2,$3) on conflict (user_id, module) do nothing`,
    [userId, module, admin.id],
  );
  return NextResponse.json({ ok: true, modules: await listUserModules(userId, "user") });
}

/** DELETE /api/admin/grants?userId=&module= —— 撤销授权（幂等） */
export async function DELETE(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    const user = await getCurrentUser();
    return NextResponse.json({ error: user ? "仅管理员" : "未登录" }, { status: user ? 403 : 401 });
  }
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const module = searchParams.get("module");
  if (!userId || !module || !VALID.has(module)) {
    return NextResponse.json({ error: "userId 与 module（debt/trade_review）必填" }, { status: 400 });
  }
  await pool.query(`delete from user_module_grants where user_id = $1 and module = $2`, [
    userId,
    module,
  ]);
  return NextResponse.json({ ok: true });
}
