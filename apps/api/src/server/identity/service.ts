/**
 * identity 域 service（REQ-004 FR-B1 / 4-C）：登录/注册/会话/资料的业务与事务边界。
 * 迁移自 auth/* 路由（4-B 安全语义保留：登录双层防护、模糊文案、setup 一次性令牌）。
 */
import { ApiError } from "../platform/http/errors";
import { assertLoginAllowed, recordLoginAttempt, clientIp } from "../platform/security/login-guard";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "@/server/platform/config";
import { createSession, destroySession } from "@/server/identity/auth";
import { verifyPassword, hashPassword, isValidPhone } from "@/server/identity/auth-crypto";
import { isValidEmail, verifyEmailCode, emailConfigured, sendEmailCode } from "@/server/identity/email";
import { verifySmsCode, smsConfigured, sendSmsCode } from "@/server/identity/sms";
import { PRESET_ACTIVITIES } from "@/server/time/seed";
import { pool } from "@/server/platform/db";
import { profilesRepo } from "./repo";

/** 登录防护记录失败不影响主流程：悬空 Promise 的 rejection 在 Node ≥15 会崩进程，必须就地兜底 */
const noteAttempt = (identity: string, ip: string, ok: boolean) =>
  recordLoginAttempt(identity, ip, ok).catch((e) =>
    console.warn("[login-guard] 尝试记录失败（忽略）:", String(e).slice(0, 120)),
  );

export interface LoginInput {
  phone?: string;
  email?: string;
  password?: string;
  smsCode?: string;
  emailCode?: string;
  /** 请求派生（限流/审计用） */
  ip: string;
  userAgent?: string | null;
}

/** 登录：双身份 + 三凭证。成功返回 {token,user}；失败抛 ApiError（文案模糊，不暴露账号存在性）。 */
export async function login(input: LoginInput) {
  const byEmail = !input.phone && !!input.email;
  if (!byEmail && (!input.phone || !isValidPhone(input.phone))) {
    throw ApiError.badRequest("请填写正确的手机号");
  }
  if (byEmail && (!input.email || !isValidEmail(input.email))) {
    throw ApiError.badRequest("请填写正确的邮箱地址");
  }
  const identity = byEmail ? input.email!.trim().toLowerCase() : input.phone!;

  try {
    await assertLoginAllowed(identity, input.ip);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "尝试次数过多，请稍后再试";
    throw new ApiError(423, "locked", msg);
  }

  const { rows } = await profilesRepo.byIdentity(identity, byEmail);
  const user = rows[0];
  const fuzzyFail = () =>
    ApiError.unauthorized(byEmail ? "邮箱或密码不正确" : "手机号或密码不正确");

  if (!user) {
    void noteAttempt(identity, input.ip, false);
    throw fuzzyFail();
  }

  if (input.password) {
    if (!user.password_hash || !verifyPassword(input.password, user.password_hash)) {
      void noteAttempt(identity, input.ip, false);
      throw fuzzyFail();
    }
  } else if (byEmail) {
    if (!user.email_verified) {
      throw new ApiError(403, "forbidden", "该邮箱未完成验证，请使用密码登录");
    }
    if (!input.emailCode || !(await verifyEmailCode(identity, "login", input.emailCode))) {
      void noteAttempt(identity, input.ip, false);
      throw ApiError.unauthorized("验证码错误或已过期");
    }
  } else {
    if (!user.phone_verified) {
      throw new ApiError(403, "forbidden", "该账号手机号未验证，请使用密码登录");
    }
    if (!input.smsCode || !(await verifySmsCode(identity, "login", input.smsCode))) {
      void noteAttempt(identity, input.ip, false);
      throw ApiError.unauthorized("验证码错误或已过期");
    }
  }

  await noteAttempt(identity, input.ip, true);
  await profilesRepo.touchLastLogin(user.id);
  const token = await createSession(user.id, input.userAgent ?? undefined);
  return { ok: true as const, token, user: { id: user.id, nickname: user.nickname } };
}

/** 退出当前会话 */
export async function logout() {
  await destroySession();
  return { ok: true as const };
}

/** 全端登出：吊销该用户全部会话（FR-C1.3） */
export async function logoutAll(userId: string) {
  await pool.query(`delete from sessions where user_id = $1`, [userId]);
  await destroySession();
  return { ok: true as const };
}

/** 当前会话信息（me） */
export async function me(user: {
  id: string;
  nickname: string | null;
  phone: string | null;
  role: string;
}) {
  const { rows } = await profilesRepo.info(user.id);
  // 模块授权（031）在 platform；4-D 迁移后由 server/platform/modules 提供
  const { listUserModules } = await import("@/server/platform/modules");
  return {
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    authDisabled: loadConfig().authDisabled,
    isAdmin: user.role === "admin",
    modules: await listUserModules(user.id, user.role),
    phoneVerified: rows[0]?.phone_verified ?? false,
    createdAt: rows[0]?.created_at ?? null,
  };
}

export interface ProfileInput {
  nickname?: string;
  currentPassword?: string;
  newPassword?: string;
}

/** 改昵称/改密码（从未设过密码的账号可免填当前密码） */
export async function updateProfile(userId: string, body: ProfileInput) {
  const wantsNickname = body.nickname !== undefined;
  const wantsPassword = body.newPassword !== undefined;
  let nickname: string | undefined;
  let message: string | undefined;

  if (wantsNickname) {
    nickname = body.nickname!.trim();
    if (!nickname || nickname.length > 20) {
      throw ApiError.badRequest("昵称需为 1~20 个字符");
    }
    await profilesRepo.setNickname(userId, nickname);
  }

  if (wantsPassword) {
    if (body.newPassword!.length < 8) {
      throw ApiError.badRequest("新密码至少 8 位");
    }
    const stored = await profilesRepo.passwordHashOf(userId);
    if (stored && (!body.currentPassword || !verifyPassword(body.currentPassword, stored))) {
      throw ApiError.unauthorized("当前密码不正确");
    }
    await profilesRepo.setPasswordHash(userId, hashPassword(body.newPassword!));
    message = "密码已更新";
  }

  return { ok: true as const, nickname, message };
}

/** 注册（邀请码）：完整实现保留在路由编排（含通道验证/预设播种），此处做参数校验面 */
export function validateRegisterIdentity(input: { phone?: string; email?: string }) {
  const byEmail = !input.phone && !!input.email;
  if (!byEmail && (!input.phone || !isValidPhone(input.phone))) {
    throw ApiError.badRequest("请填写正确的手机号");
  }
  if (byEmail && (!input.email || !isValidEmail(input.email))) {
    throw ApiError.badRequest("请填写正确的邮箱地址");
  }
  return byEmail;
}

/**
 * setup 一次性令牌校验（FR-C2.3）：配置了 SETUP_TOKEN 即强制。
 * 校验通过才消费（一次性）；输错不烧令牌——否则一次手滑就永久作废，只能改 env 重置。
 */
export async function assertSetupToken(tokenHeader: string | null) {
  const expect = loadConfig().setupToken;
  if (!expect) return;
  const { rows: used } = await pool.query(`select value from app_config where key = 'setup_token_used'`, []);
  if (used[0]) throw new ApiError(410, "conflict", "初始化令牌已失效");
  const a = Buffer.from(tokenHeader ?? "");
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(403, "forbidden", "初始化令牌不正确");
  }
  await consumeSetupToken();
}

async function consumeSetupToken() {
  await pool.query(
    `insert into app_config (key, value) values ('setup_token_used', to_jsonb(now()))
     on conflict (key) do nothing`,
    [],
  );
}

/** 初始化管理员（一次性令牌校验 + 抢占防护） */
export async function setup(input: { nickname?: string; phone?: string; password?: string }, tokenHeader: string | null, userAgent?: string | null) {
  // 先完成全部入参/前置校验，最后一步才消费一次性令牌（否则畸形请求也会烧掉令牌）
  if (!input.nickname?.trim() || !input.phone || !isValidPhone(input.phone)) {
    throw ApiError.badRequest("请填写昵称和正确的手机号");
  }
  if (!input.password || input.password.length < 8) {
    throw ApiError.badRequest("密码至少 8 位");
  }
  const existing = await profilesRepo.hasPhoneAccount();
  if (existing.rows.length > 0) {
    throw ApiError.forbidden("管理员已存在，请直接登录");
  }
  await assertSetupToken(tokenHeader);
  const { rows } = await profilesRepo.claimDevAdmin(input.nickname.trim(), input.phone, hashPassword(input.password));
  if (!rows[0]) throw ApiError.upstream("初始化失败");
  const token = await createSession(rows[0].id, userAgent ?? undefined);
  return { ok: true as const, token, user: rows[0] };
}

export { isValidPhone, hashPassword, clientIp };

export interface RegisterInput {
  phone?: string;
  email?: string;
  password?: string;
  inviteCode?: string;
  smsCode?: string;
  emailCode?: string;
  nickname?: string;
  userAgent?: string | null;
}

/** 注册（邀请码，双身份二选一）：通道已配置须验证码；未配置邀请码即凭证。迁移自 auth/register 路由。 */
export async function register(input: RegisterInput) {
  const { nickname: nicknameRaw } = input;
  const nickname = nicknameRaw?.trim();
  if (!nickname || nickname.length > 20) throw ApiError.badRequest("请填写昵称（1-20 个字符）");
  const byEmail = validateRegisterIdentity(input);
  if (!input.password || input.password.length < 8) throw ApiError.badRequest("密码至少 8 位");
  if (!input.inviteCode?.trim()) throw ApiError.badRequest("请填写邀请码");

  const code = input.inviteCode.trim().toUpperCase();
  // 前置快查（友好 400，早于通道验证）；真正的并发安全由下方事务内带守卫的核销保证
  const invite = await pool.query(
    `select code from invite_codes
     where code = $1 and used_by is null and (expires_at is null or expires_at > now())`,
    [code],
  );
  if (invite.rows.length === 0) throw ApiError.badRequest("邀请码无效或已被使用");

  const emailNorm = byEmail ? input.email!.trim().toLowerCase() : null;
  const phone = input.phone;
  const dup = await pool.query(`select phone, email from profiles where phone = $1 or email = $2`, [
    byEmail ? null : phone,
    emailNorm,
  ]);
  if (dup.rows.length > 0) {
    const hit = byEmail ? dup.rows[0].email : dup.rows[0].phone;
    if (byEmail && hit) throw ApiError.badRequest("该邮箱已注册，请直接登录");
    if (!byEmail && hit) throw ApiError.badRequest("该手机号已注册，请直接登录");
  }

  let phoneVerified = false;
  let emailVerified = false;
  if (byEmail) {
    if (emailConfigured()) {
      if (!input.emailCode) throw ApiError.badRequest("请填写邮箱验证码");
      if (!(await verifyEmailCode(emailNorm!, "login", input.emailCode))) {
        throw ApiError.badRequest("验证码错误或已过期");
      }
      emailVerified = true;
    }
  } else if (smsConfigured()) {
    if (!input.smsCode) throw ApiError.badRequest("请填写短信验证码");
    if (!(await verifySmsCode(phone!, "login", input.smsCode))) {
      throw ApiError.badRequest("验证码错误或已过期");
    }
    phoneVerified = true;
  }

  // 事务（4-F P1）：建号 + 邀请码核销 + 预设播种 原子完成，中途失败整体回滚不留半成品；
  // 核销带 used_by is null 守卫，并发复用同一邀请码时仅一端成功，另一端回滚并拒绝
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `insert into profiles (nickname, phone, email, phone_verified, email_verified, password_hash, last_login_at)
       values ($1, $2, $3, $4, $5, $6, now()) returning id, nickname`,
      [nickname, byEmail ? null : phone, emailNorm, phoneVerified, emailVerified, hashPassword(input.password)],
    );
    const user = rows[0];
    const claimed = await client.query(
      `update invite_codes set used_by = $1, used_at = now()
       where code = $2 and used_by is null and (expires_at is null or expires_at > now())
       returning code`,
      [user.id, code],
    );
    if (claimed.rows.length === 0) throw ApiError.badRequest("邀请码无效或已被使用");
    // 九大预设分类：新用户开箱即用（与 seed.ts 同构；须在本事务同连接执行，
    // 走独立连接会因 FK 等待未提交的建号行而挂起）
    for (const a of PRESET_ACTIVITIES) {
      await client.query(
        `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (id, user_id) do nothing`,
        [a.id, user.id, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
      );
    }
    await client.query("commit");
    const token = await createSession(user.id, input.userAgent ?? undefined);
    return { ok: true as const, token, user };
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // 连接已不可用：释放即可
    }
    // 并发注册同一手机号/邮箱：快查双双通过后唯一约束兜底，转友好提示而非 500
    if ((e as { code?: string }).code === "23505") {
      throw ApiError.conflict("该手机号/邮箱已注册，请直接登录");
    }
    throw e;
  } finally {
    client.release();
  }
}

/** 发送短信验证码（同号 60s/次、日 10 条策略在通道层） */
export async function sendSms(input: { phone?: string; purpose?: string }) {
  if (!input.phone || !isValidPhone(input.phone)) throw ApiError.badRequest("请填写正确的手机号");
  const purpose = input.purpose === "bind" ? "bind" : "login";
  const r = await sendSmsCode(input.phone, purpose);
  if (!r.ok) throw new ApiError(r.status, "upstream", r.error ?? "发送失败");
  return { ok: true as const };
}

/** 发送邮箱验证码 */
export async function sendEmail(input: { email?: string; purpose?: string }) {
  if (!input.email || !isValidEmail(input.email)) throw ApiError.badRequest("请填写正确的邮箱地址");
  const purpose = input.purpose === "bind" ? "bind" : "login";
  const r = await sendEmailCode(input.email.trim().toLowerCase(), purpose);
  if (!r.ok) throw new ApiError(r.status, "upstream", r.error ?? "发送失败");
  return { ok: true as const };
}
