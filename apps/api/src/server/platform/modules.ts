/**
 * 模块级授权门禁（REQ-003 3-F FR-C2.1，迁移 031）
 * admin 直通；普通用户查 user_module_grants，未授权返回 null（路由自行 403「未开通该模块」）。
 * 首期模块：debt 负债管理、trade_review 收支复盘（REQ-005 FR-4.4 更名）。实时查库无缓存——授权/撤销即时生效。
 */
import { pool } from "@/server/platform/db";
import { getCurrentUser, type SessionUser } from "@/server/identity/auth";

export const MODULES = ["debt", "trade_review", "trading"] as const;
export type ModuleKey = (typeof MODULES)[number];

/** 三态：user=已授权（或 admin 直通）；"unauthenticated"=未登录（401）；null=已登录未开通（403）。
 *  单次会话查询同时区分 401/403——调用方不再需要二次 getCurrentUser（双查且结果可能不一致） */
export type ModuleUserResult = SessionUser | "unauthenticated" | null;

export async function getModuleUser(module: ModuleKey): Promise<ModuleUserResult> {
  const user = await getCurrentUser();
  if (!user) return "unauthenticated";
  if (user.role === "admin") return user;
  const { rows } = await pool.query(
    `select 1 from user_module_grants where user_id = $1 and module = $2`,
    [user.id, module],
  );
  return rows[0] ? user : null;
}

/** 用户的已授权模块列表（admin 全量；登录门禁由调用方负责） */
export async function listUserModules(userId: string, role: string): Promise<string[]> {
  if (role === "admin") return [...MODULES];
  const { rows } = await pool.query(
    `select module from user_module_grants where user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.module as string);
}
