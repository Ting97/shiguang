/**
 * 登录防护（REQ-004 FR-C1 / 威胁 T2）：双层
 * - IP 层：进程内滑动窗口（15 分钟 20 次失败 → 封 15 分钟），单机假设
 * - 身份层：DB 持久（login_attempts，034）——30 分钟内 20 次失败 → 锁定 30 分钟
 * 统一模糊文案：不区分「账号不存在/密码错/被锁细节」（锁定的 423 文案单独给重试语义）。
 */
import { pool } from "@/lib/db";
import { hitRateLimit } from "./rate-limit";
import { log } from "../http/logger";

const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX_FAILS = 20;
const ID_LOCK_WINDOW = "30 minutes";
const ID_MAX_FAILS = 20;

export class LoginLockedError extends Error {
  constructor(message = "尝试次数过多，请稍后再试") {
    super(message);
    this.name = "LoginLockedError";
  }
}

/** 客户端 IP（反代后从 x-forwarded-for 取第一个） */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** 登录前置检查：任一层命中即抛 LoginLockedError（路由转 423） */
export async function assertLoginAllowed(identity: string, ip: string): Promise<void> {
  const ipLayer = hitRateLimit(`login:ip:${ip}`, IP_WINDOW_MS, IP_MAX_FAILS);
  if (ipLayer.blocked) {
    log.warn({ ip, layer: "ip" }, "login-blocked");
    throw new LoginLockedError();
  }
  const { rows } = await pool.query(
    `select count(*)::int as n from login_attempts
     where identity = $1 and success = false and created_at > now() - interval '${ID_LOCK_WINDOW}'`,
    [identity],
  );
  if (rows[0].n >= ID_MAX_FAILS) {
    log.warn({ identity: identity.slice(0, 4) + "***", layer: "identity", fails: rows[0].n }, "login-blocked");
    throw new LoginLockedError();
  }
}

/** 记录一次尝试；成功时清空该身份的失败记录（给用户"改对了立刻能进"的体验） */
export async function recordLoginAttempt(identity: string, ip: string, success: boolean): Promise<void> {
  await pool.query(
    `insert into login_attempts (identity, ip, success) values ($1,$2,$3)`,
    [identity, ip, success],
  );
  if (success) {
    await pool.query(`delete from login_attempts where identity = $1 and success = false`, [identity]);
  }
}
