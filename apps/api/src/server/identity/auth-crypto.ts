/**
 * 认证纯函数（Node crypto，零外部依赖）——不含 Next 上下文，便于单测
 * 密码 scrypt；会话 token 随机 256bit，库里只存 sha256
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

/** 手机号格式（中国大陆） */
export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/** 密码哈希：格式 scrypt$N$saltHex$hashHex */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 校验密码（timingSafeEqual 防时序侧信道） */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  const actual = scryptSync(password, salt, expected.length, { N: n });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 新会话 token（放 cookie 的明文随机值） */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** token/验证码入库前的 sha256 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 6 位短信验证码 */
export function generateSmsCode(): string {
  return String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
}

/** 邀请码：8 位易读字符集（去掉 0/O/1/I） */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return code;
}
