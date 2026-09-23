/**
 * 会话与当前用户（Next 上下文）
 * - cookie shiguang_session 只放随机 token，库里存 sha256，可吊销
 * - AUTH_DISABLED=1 仅限本地开发：跳过登录，直接以开发用户身份运行（生产禁止设置）
 */
import { cookies, headers } from "next/headers";
import { pool, DEV_USER_ID } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { generateSessionToken, hashToken } from "@/server/identity/auth-crypto";
import { extractBearerToken } from "@shiguangri/shared/bearer";

export const SESSION_COOKIE = "shiguang_session";
const SESSION_TTL_MS = 30 * 86_400_000; // 30 天
const SLIDE_THRESHOLD_MS = 15 * 86_400_000; // 剩余不足 15 天则滑动续期

export interface SessionUser {
  id: string;
  nickname: string | null;
  phone: string | null;
  role: "user" | "admin";
}

/**
 * 当前用户：AUTH_DISABLED → 开发用户（仍读库取最新资料）；否则解析会话（无效/过期 → null）。
 * 双通道：优先 Authorization: Bearer（原生端），否则回落 cookie（Web 同域）。
 * 同一张 sessions 表，均享受过期清理与滑动续期。
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (loadConfig().authDisabled) {
    const { rows } = await pool.query(
      `select id, nickname, phone, role from profiles where id = $1`,
      [DEV_USER_ID],
    );
    return rows[0] ?? { id: DEV_USER_ID, nickname: "开发者", phone: null, role: "admin" };
  }
  const bearer = extractBearerToken((await headers()).get("authorization"));
  let token = bearer;
  if (!token) {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value ?? null;
  }
  if (!token) return null;

  const { rows } = await pool.query(
    `select p.id, p.nickname, p.phone, p.role, s.expires_at
     from sessions s join profiles p on p.id = s.user_id
     where s.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;

  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    await pool.query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
    return null;
  }
  // 滑动续期：剩余不足一半时延长到完整 TTL
  if (expiresAt.getTime() - Date.now() < SLIDE_THRESHOLD_MS) {
    await pool.query(`update sessions set expires_at = $1 where token_hash = $2`, [
      new Date(Date.now() + SESSION_TTL_MS),
      hashToken(token),
    ]);
  }
  return { id: row.id, nickname: row.nickname, phone: row.phone, role: row.role };
}

/**
 * 管理员门禁：非登录返回 null（路由自行 401），非 admin 返回 null（路由自行 403）。
 * 用法：const admin = await getAdminUser(); if (!admin) return 401/403 响应。
 * 需区分 401/403 时用 getCurrentUser + role 判断。
 */
export async function getAdminUser(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  return user && user.role === "admin" ? user : null;
}

/**
 * 登录/注册成功后建会话并写 cookie，返回明文 token（响应体下发给原生端存 SecureStore）。
 * cookie 照常写入：Web 同域零回归；Bearer 供跨 origin 原生端使用。
 */
export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = generateSessionToken();
  await pool.query(
    `insert into sessions (user_id, token_hash, user_agent, expires_at)
     values ($1,$2,$3,$4)`,
    [userId, hashToken(token), userAgent ?? null, new Date(Date.now() + SESSION_TTL_MS)],
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: loadConfig().secureCookie,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
  return token;
}

/**
 * 退出：删会话行 + 清 cookie。
 * token 解析与 getCurrentUser 同构：优先 Authorization: Bearer（原生端），回落 cookie（Web）——
 * 否则原生端带 Bearer 调登出时 token 取不到，会话不被吊销却返回 ok（4-F P1 修复）。
 */
export async function destroySession(): Promise<void> {
  const bearer = extractBearerToken((await headers()).get("authorization"));
  const store = await cookies();
  const token = bearer ?? store.get(SESSION_COOKIE)?.value ?? null;
  if (token) {
    await pool.query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
  }
  store.delete(SESSION_COOKIE);
}
