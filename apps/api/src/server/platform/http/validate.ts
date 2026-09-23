/**
 * 请求级入参预检助手：在触碰 SQL / 业务域前把畸形入参拦成 400，
 * 避免 PG cast（22P02）或 JS 运行时异常（RangeError/TypeError）漏成 500。
 */
import { ApiError } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 值是否为 uuid 形状（大小写不敏感；非字符串一律 false） */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** uuid 入参预检：非法直接 400（文案与全站一致），合法原样返回 */
export function assertUuidParam(v: unknown, label = "id"): string {
  if (!isUuid(v)) throw ApiError.badRequest(`${label} 参数不合法`);
  return v;
}

/** YYYY-MM 形状且月份 01-12（拒绝 2025-13 静默空数据 / 落 date 列 500） */
export function isValidYearMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 可选字符串字段归一：undefined/null → undefined；非字符串 → 400；字符串 → trim。
 * 替代 `body.x?.trim()`（对 123 等非字符串抛 TypeError → 500）。 */
export function optionalTrimmed(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw ApiError.badRequest(`${label} 需为字符串`);
  return v.trim();
}
