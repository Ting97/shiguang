/**
 * 微信小程序登录/绑定：
 * - loginByWechat：jscode2session → openid 命中 wechat_openid 即建会话；未命中自动建号
 *   （免绑手机号，昵称取用户授权资料；REQ-游客/微信直登）
 * - bindWechat：票据 + 手机号 + 短信验证码（purpose=bind）→ 绑定既有账号并建会话
 *   （登录流程不再强制绑定；票据流程保留给「微信号 ↔ 已有手机账号」互通场景）
 * 票据/验证码均为单次消费：验证码先核销（天然并发串行），票据 DELETE 认领兜底并发；
 * 票据库只存 sha256（与会话 token/验证码同口径）。
 */
import { pool } from "@/server/platform/db";
import { jscode2session, enforceUgcText } from "@/server/platform/wechat";
import { ApiError } from "@/server/platform/http/errors";
import { createSession } from "@/server/identity/auth";
import { hashToken, isValidPhone } from "@/server/identity/auth-crypto";
import { verifySmsCode } from "@/server/identity/sms";
import { PRESET_ACTIVITIES } from "@/server/time/seed";

export interface WechatLoginInput {
  code: string;
  /** 用户授权弹窗里同意的资料（可选）：昵称用于自动建号 */
  profile?: { nickname?: string };
  userAgent?: string | null;
}

/** 默认昵称：微信用户 + 4 位随机（unique 兜底场景极小，见 23505 分支） */
function fallbackNickname(): string {
  return `微信用户${Math.floor(1000 + Math.random() * 9000)}`;
}

/** 授权昵称净化：去尖括号/压空白/限长——入库前最小防御 */
function sanitizeNickname(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return cleaned || fallbackNickname();
}

/** 登录路径共用：最后登录时间 + 发会话（老用户与并发首登兜底共用） */
async function issueSessionFor(
  user: { id: string; nickname: string; status: string },
  unionid: string | null,
  userAgent?: string | null,
) {
  if (user.status !== "active") throw new ApiError(403, "forbidden", "账号已被禁用");
  await pool.query(
    `update profiles set last_login_at = now()${unionid ? ", wechat_unionid = coalesce(wechat_unionid, $2)" : ""} where id = $1`,
    unionid ? [user.id, unionid] : [user.id],
  );
  const token = await createSession(user.id, userAgent ?? "miniapp");
  return { ok: true as const, bound: true as const, token, user: { id: user.id, nickname: user.nickname } };
}

/** 一键登录：命中 wechat_openid 直接发会话；未命中自动建号（免绑手机号，直登体验） */
export async function loginByWechat(input: WechatLoginInput) {
  const { openid, unionid } = await jscode2session(input.code);
  const { rows } = await pool.query(
    `select id, nickname, status from profiles where wechat_openid = $1`,
    [openid],
  );
  const user = rows[0];
  if (user) return issueSessionFor(user, unionid, input.userAgent);

  // 未命中 → 自动建号：昵称取用户授权资料（拒绝授权用默认昵称，可后改）；
  // 播种九大预设分类与 web 注册同口径，保证开箱即用。事务保证「建号+播种」原子（4-F P1 同范式）。
  const nickname = sanitizeNickname(input.profile?.nickname);
  const client = await pool.connect();
  let created: { id: string; nickname: string };
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into profiles (nickname, wechat_openid, wechat_unionid, phone_verified, last_login_at)
       values ($1, $2, $3, false, now()) returning id, nickname`,
      [nickname, openid, unionid],
    );
    created = inserted.rows[0];
    for (const a of PRESET_ACTIVITIES) {
      await client.query(
        `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (id, user_id) do nothing`,
        [a.id, created.id, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
      );
    }
    await client.query("commit");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // 连接已不可用：释放即可
    }
    // wechat_openid unique：并发首登另一请求已建号 → 按 openid 重查走登录路径
    if ((e as { code?: string }).code === "23505") {
      const again = await pool.query(`select id, nickname, status from profiles where wechat_openid = $1`, [openid]);
      if (again.rows[0]) return issueSessionFor(again.rows[0], unionid, input.userAgent);
    }
    throw e;
  } finally {
    client.release();
  }

  // 昵称过一道内容安全（msgSecCheck 降级放行的同口径不适用——这里必须放行登录，
  // 被拒则换默认昵称，不因昵称卡住进入）
  try {
    await enforceUgcText(created.id, created.nickname);
  } catch (e) {
    if (e instanceof ApiError) {
      const fixed = await pool.query(`update profiles set nickname = $2 where id = $1 returning nickname`, [
        created.id,
        fallbackNickname(),
      ]);
      created = { id: created.id, nickname: fixed.rows[0].nickname };
    } else {
      throw e;
    }
  }

  const token = await createSession(created.id, input.userAgent ?? "miniapp");
  return {
    ok: true as const,
    bound: true as const,
    created: true as const,
    token,
    user: { id: created.id, nickname: created.nickname },
  };
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
