/**
 * identity 域 service（REQ-004 FR-B1 / 4-C）：登录/注册/会话/资料的业务与事务边界。
 * 迁移自 auth/* 路由（4-B 安全语义保留：登录双层防护、模糊文案、setup 一次性令牌）。
 */
import { ApiError } from "../platform/http/errors";
import { assertLoginAllowed, recordLoginAttempt, clientIp } from "../platform/security/login-guard";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword, hashPassword, isValidPhone } from "@/lib/auth-crypto";
import { isValidEmail, verifyEmailCode, emailConfigured, sendEmailCode } from "@/lib/email";
import { verifySmsCode, smsConfigured, sendSmsCode } from "@/lib/sms";
import { seedPresetActivities } from "@/lib/seed";
import { pool } from "@/lib/db";
import { profilesRepo } from "./repo";

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
    void recordLoginAttempt(identity, input.ip, false);
    throw fuzzyFail();
  }

  if (input.password) {
    if (!user.password_hash || !verifyPassword(input.password, user.password_hash)) {
      void recordLoginAttempt(identity, input.ip, false);
      throw fuzzyFail();
    }
  } else if (byEmail) {
    if (!user.email_verified) {
      throw new ApiError(403, "forbidden", "该邮箱未完成验证，请使用密码登录");
    }
    if (!input.emailCode || !(await verifyEmailCode(identity, "login", input.emailCode))) {
      void recordLoginAttempt(identity, input.ip, false);
      throw ApiError.unauthorized("验证码错误或已过期");
    }
  } else {
    if (!user.phone_verified) {
      throw new ApiError(403, "forbidden", "该账号手机号未验证，请使用密码登录");
    }
    if (!input.smsCode || !(await verifySmsCode(identity, "login", input.smsCode))) {
      void recordLoginAttempt(identity, input.ip, false);
      throw ApiError.unauthorized("验证码错误或已过期");
    }
  }

  await recordLoginAttempt(identity, input.ip, true);
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
  const { listUserModules } = await import("@/lib/modules");
  return {
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    authDisabled: process.env.AUTH_DISABLED === "1",
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

/** setup 一次性令牌校验（FR-C2.3）：配置了 SETUP_TOKEN 即强制；任一次调用（成败）都消费 */
export async function assertSetupToken(tokenHeader: string | null) {
  const expect = process.env.SETUP_TOKEN;
  if (!expect) return;
  const { rows: used } = await pool.query(`select value from app_config where key = 'setup_token_used'`, []);
  if (used[0]) throw new ApiError(410, "conflict", "初始化令牌已失效");
  const got = tokenHeader ?? "";
  if (got !== expect) {
    await consumeSetupToken();
    throw new ApiError(403, "forbidden", "初始化令牌不正确（已作废）");
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
  await assertSetupToken(tokenHeader);
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

  const invite = await pool.query(
    `select code from invite_codes
     where code = $1 and used_by is null and (expires_at is null or expires_at > now())`,
    [input.inviteCode.trim().toUpperCase()],
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

  const { rows } = await pool.query(
    `insert into profiles (nickname, phone, email, phone_verified, email_verified, password_hash, last_login_at)
     values ($1, $2, $3, $4, $5, $6, now()) returning id, nickname`,
    [nickname, byEmail ? null : phone, emailNorm, phoneVerified, emailVerified, hashPassword(input.password)],
  );
  const user = rows[0];
  await seedPresetActivities(user.id); // 九大预设分类：新用户开箱即用
  await pool.query(`update invite_codes set used_by = $1, used_at = now() where code = $2`, [
    user.id,
    input.inviteCode.trim().toUpperCase(),
  ]);
  const token = await createSession(user.id, input.userAgent ?? undefined);
  return { ok: true as const, token, user };
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
