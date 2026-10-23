/**
 * 训记 Open API key 每用户绑定（REQ-042）：
 * - 存取：user_integration_keys（provider='xunji'），AES-256-GCM 加密（与 user_exchange_keys 同格式：
 *   iv12 + tag16 + 密文，整体 base64；密钥 EXCHANGE_ENC_KEY）——key 整体是秘密，明文永不入库/日志/回显
 * - 绑定即校验：validateXunjiKey 读哨兵日期，坏 key 当场报训记原因不落库（Bitget 绑定同防线）
 * - 解析：getXunjiKey 供 sync/pull/chat 工具严格取当前用户自己的 key（不再回落部署级 env——
 *   env key 是运营者个人账号，回落会造成写入他人训记账号）
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { ApiError } from "@/server/platform/http/errors";
import type { FetchLike } from "./xunji";
import { validateXunjiKey } from "./xunji";

export const XUNJI_PROVIDER = "xunji";

function encKeyBytes(): Buffer {
  const raw = loadConfig().exchangeEncKey;
  if (!raw) throw new ApiError(503, "upstream", "未配置 EXCHANGE_ENC_KEY，暂不支持绑定训记 apiKey");
  return createHash("sha256").update(raw).digest();
}

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKeyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encKeyBytes(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** 当前用户绑定的训记 key（未绑定返回 null；加密列损坏/密钥不符抛 503 而非静默当未绑定） */
export async function getXunjiKey(userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `select api_key_enc from user_integration_keys where user_id = $1 and provider = $2`,
    [userId, XUNJI_PROVIDER],
  );
  if (!rows.length) return null;
  try {
    return decryptSecret(rows[0].api_key_enc);
  } catch {
    throw new ApiError(503, "upstream", "训记 apiKey 解密失败（EXCHANGE_ENC_KEY 与绑定时不一致？）——请重新绑定");
  }
}

const maskKey = (key: string) => (key.length <= 6 ? "******" : `${key.slice(0, 3)}***${key.slice(-3)}`);

/** 绑定状态（脱敏）：供【我的 → 训记同步】卡与 xunji-status 展示 */
export async function getXunjiKeyInfo(userId: string): Promise<{ bound: boolean; apiKeyMasked?: string; updatedAt?: string }> {
  const { rows } = await pool.query(
    `select api_key_enc, updated_at from user_integration_keys where user_id = $1 and provider = $2`,
    [userId, XUNJI_PROVIDER],
  );
  if (!rows.length) return { bound: false };
  let masked: string;
  try {
    masked = maskKey(decryptSecret(rows[0].api_key_enc));
  } catch {
    masked = "（解密失败）";
  }
  return { bound: true, apiKeyMasked: masked, updatedAt: new Date(rows[0].updated_at).toISOString() };
}

/** 绑定/更新 key：先远端即时校验再加密落库；明文只经过函数参数，不落日志 */
export async function saveXunjiKey(userId: string, apiKey: string, fetcher?: FetchLike): Promise<{ apiKeyMasked: string }> {
  const key = apiKey.trim();
  if (!key || key.length > 128) throw ApiError.badRequest("训记 apiKey 不能为空且不超过 128 字符");
  await validateXunjiKey(key, fetcher); // 坏 key 抛 502（含训记官方原因）
  const enc = encryptSecret(key);
  await pool.query(
    `insert into user_integration_keys (user_id, provider, api_key_enc, updated_at)
     values ($1, $2, $3, now())
     on conflict (user_id, provider) do update
       set api_key_enc = excluded.api_key_enc, updated_at = now()`,
    [userId, XUNJI_PROVIDER, enc],
  );
  return { apiKeyMasked: maskKey(key) };
}

/** 解绑（训记侧已写入的数据不受影响） */
export async function removeXunjiKey(userId: string): Promise<void> {
  await pool.query(`delete from user_integration_keys where user_id = $1 and provider = $2`, [userId, XUNJI_PROVIDER]);
}
