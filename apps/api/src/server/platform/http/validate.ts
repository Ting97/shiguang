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

/** 文本主键入参预检：id 列为 text（预设分类 'sleep' 等非 uuid）的表专用——
 * 只做非空与长度形状检查防超长串落库，查无此 id 由业务层自然 404。 */
export function assertTextIdParam(v: unknown, label = "id"): string {
  if (typeof v !== "string" || !v.trim() || v.length > 64) throw ApiError.badRequest(`${label} 参数不合法`);
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

/** int 列数值字段预检：非数值 defaultMin 过了业务层 Math.min/max 会产 NaN → int 列 500
 * （activities 路由原两处复制体收敛于此） */
export function assertNumericBody(body: unknown): void {
  const b = (body ?? {}) as { defaultMin?: unknown };
  if (b.defaultMin != null && (typeof b.defaultMin !== "number" || !Number.isInteger(b.defaultMin))) {
    throw ApiError.badRequest("defaultMin 需为整数（分钟）");
  }
}
