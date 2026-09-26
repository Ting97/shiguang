/**
 * 微信小程序登录/绑定（docs/15 第 1 批）：
 * - loginByWechat：jscode2session → openid 命中 wechat_openid 即建会话；未命中签发一次性绑定票据（5 分钟）
 * - bindWechat：票据 + 手机号 + 短信验证码（purpose=bind）→ 绑定并建会话
 * 票据/验证码均为单次消费：验证码先核销（天然并发串行），票据 DELETE 认领兜底并发；
 * 票据库只存 sha256（与会话 token/验证码同口径）。
 */
import { pool } from "@/server/platform/db";
import { jscode2session } from "@/server/platform/wechat";
import { ApiError } from "@/server/platform/http/errors";
import { createSession } from "@/server/identity/auth";
import { generateSessionToken, hashToken, isValidPhone } from "@/server/identity/auth-crypto";
import { verifySmsCode } from "@/server/identity/sms";

export interface WechatLoginInput {
  code: string;
  userAgent?: string | null;
}

/** 一键登录：已绑定直接发会话；未绑定发绑定票据（前端引导短信验证码绑定） */
export async function loginByWechat(input: WechatLoginInput) {
  const { openid, unionid } = await jscode2session(input.code);
  const { rows } = await pool.query(
    `select id, nickname, status from profiles where wechat_openid = $1`,
    [openid],
  );
  const user = rows[0];
  if (user) {
    if (user.status !== "active") throw new ApiError(403, "forbidden", "账号已被禁用");
    await pool.query(
      `update profiles set last_login_at = now()${unionid ? ", wechat_unionid = coalesce(wechat_unionid, $2)" : ""} where id = $1`,
      unionid ? [user.id, unionid] : [user.id],
    );
    const token = await createSession(user.id, input.userAgent ?? "miniapp");
    return { ok: true as const, bound: true as const, token, user: { id: user.id, nickname: user.nickname } };
  }

  // 未绑定：签发一次性票据（惰性清理过期行防膨胀）
  await pool.query(`delete from wechat_bind_tickets where expires_at < now()`, []);
  const ticket = generateSessionToken();
  await pool.query(
    `insert into wechat_bind_tickets (ticket_hash, openid, unionid, expires_at)
     values ($1, $2, $3, now() + interval '5 minutes')`,
    [hashToken(ticket), openid, unionid],
  );
  return { ok: true as const, bound: false as const, bindTicket: ticket, expiresIn: 300 };
}

export interface WechatBindInput {
  bindTicket: string;
  phone: string;
  smsCode: string;
  userAgent?: string | null;
}

/** 绑定手机号：验证码先核销（单次），票据 DELETE 认领（并发/过期兜底），最后落绑定 */
export async function bindWechat(input: WechatBindInput) {
  if (!isValidPhone(input.phone)) throw ApiError.badRequest("请填写正确的手机号");
  if (!input.smsCode.trim()) throw ApiError.badRequest("请填写短信验证码");
  const ticketHash = hashToken(input.bindTicket);
  const held = await pool.query(
    `select 1 from wechat_bind_tickets where ticket_hash = $1 and expires_at > now()`,
    [ticketHash],
  );
  if (!held.rows[0]) throw ApiError.badRequest("绑定凭证无效或已过期，请重新点击微信登录");
  if (!(await verifySmsCode(input.phone, "bind", input.smsCode))) {
    throw ApiError.unauthorized("验证码错误或已过期");
  }
  const claimed = await pool.query(
    `delete from wechat_bind_tickets where ticket_hash = $1 and expires_at > now() returning openid, unionid`,
    [ticketHash],
  );
  const ticket = claimed.rows[0];
  if (!ticket) throw ApiError.badRequest("绑定凭证无效或已过期，请重新点击微信登录");

  const { rows } = await pool.query(
    `select id, nickname, status, wechat_openid from profiles where phone = $1`,
    [input.phone],
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound("该手机号尚未注册，请先在网页端注册账号");
  if (user.status !== "active") throw new ApiError(403, "forbidden", "账号已被禁用");
  if (user.wechat_openid && user.wechat_openid !== ticket.openid) {
    throw ApiError.conflict("该账号已绑定其他微信，请先用原微信登录");
  }

  try {
    const updated = await pool.query(
      `update profiles
       set wechat_openid = $1, wechat_unionid = coalesce($2, wechat_unionid),
           phone_verified = true, last_login_at = now()
       where id = $3 returning id, nickname`,
      [ticket.openid, ticket.unionid, user.id],
    );
    const bound = updated.rows[0];
    const token = await createSession(bound.id, input.userAgent ?? "miniapp");
    return { ok: true as const, token, user: { id: bound.id, nickname: bound.nickname } };
  } catch (e) {
    // wechat_openid unique：并发绑定同一 openid 到另一账号
    if ((e as { code?: string }).code === "23505") {
      throw ApiError.conflict("该微信已绑定其他账号");
    }
    throw e;
  }
}
