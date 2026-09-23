/**
 * 登录防护（REQ-004 FR-C1 / 威胁 T2）：双层
 * - IP 层：进程内滑动窗口（15 分钟 20 次失败 → 封 15 分钟），单机假设
 * - 身份层：DB 持久（login_attempts，034）——30 分钟内 20 次失败 → 锁定 30 分钟
 * 统一模糊文案：不区分「账号不存在/密码错/被锁细节」（锁定的 423 文案单独给重试语义）。
 */
import { pool } from "@/server/platform/db";
import { hitRateLimit, peekRateLimit } from "./rate-limit";
import { log } from "../http/logger";

const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX_FAILS = 20;
const ID_MAX_FAILS = 20;

export class LoginLockedError extends Error {
  constructor(message = "尝试次数过多，请稍后再试") {
    super(message);
    this.name = "LoginLockedError";
  }
}

/**
 * 客户端 IP。XFF 是反代 append 语义：最左段是客户端可伪造的值，取最左会让限流键完全可控；
 * 本部署只有一层可信反代（Caddy），从右往左第一段即 Caddy 观测到的真实客户端 IP。
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "local";
}

/** 登录前置检查：任一层命中即抛 LoginLockedError（路由转 423）。IP 层只查不记——成功登录不应计入失败窗口 */
export async function assertLoginAllowed(identity: string, ip: string): Promise<void> {
  const ipLayer = peekRateLimit(`login:ip:${ip}`, IP_WINDOW_MS, IP_MAX_FAILS);
  if (ipLayer.blocked) {
    log.warn({ ip, layer: "ip" }, "login-blocked");
    throw new LoginLockedError();
  }
  const { rows } = await pool.query(
    // 窗口字面量化写死 30 minutes（仅此一处使用，不再模板插值拼接 SQL）；改动窗口需同步文件头「锁定 30 分钟」注释与该值
    `select count(*)::int as n from login_attempts
     where identity = $1 and success = false and created_at > now() - interval '30 minutes'`,
    [identity],
  );
  if (rows[0].n >= ID_MAX_FAILS) {
    log.warn({ identity: identity.slice(0, 4) + "***", layer: "identity", fails: rows[0].n }, "login-blocked");
    throw new LoginLockedError();
  }
}

/** 记录一次尝试；成功时清空该身份的失败记录（给用户"改对了立刻能进"的体验）。
 * IP 失败窗口只在失败时计数（hitRateLimit），前置检查 peekRateLimit 只读——
 * 共享出口 IP 的正常登录不再累积触发封禁（旧实现对成功登录也计数，20 次即锁 15 分钟） */
export async function recordLoginAttempt(identity: string, ip: string, success: boolean): Promise<void> {
  await pool.query(
    `insert into login_attempts (identity, ip, success) values ($1,$2,$3)`,
    [identity, ip, success],
  );
  if (success) {
    await pool.query(`delete from login_attempts where identity = $1 and success = false`, [identity]);
  } else {
    hitRateLimit(`login:ip:${ip}`, IP_WINDOW_MS, IP_MAX_FAILS);
  }
}
