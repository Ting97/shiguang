/**
 * Jev 调用模式（REQ-003 / 管理台开关）：
 * - 默认取环境变量 JEV_MODE（off | shadow | on）
 * - /admin 可写 DB 覆盖（app_config key='jev_mode'），保存即生效（60s 进程缓存 + 主动失效）
 * - on = 实时接管：3-D 未上线前仅作存储位（行为等同 off，UI 明确标注"未上线"）
 */
import { pool } from "@/server/platform/db";

export type JevModeValue = "off" | "shadow" | "on";

const CACHE_TTL_MS = 60_000;
let cache: { mode: JevModeValue; fetchedAt: number } | null = null;

/** 环境变量默认值（未设置 = off） */
export function envJevMode(): JevModeValue {
  const m = (process.env.JEV_MODE ?? "off").toLowerCase();
  return m === "shadow" ? "shadow" : m === "on" ? "on" : "off";
}

export function invalidateAiMode(): void {
  cache = null;
}

/** 生效中的调用模式：DB 覆盖优先，env 兜底；读失败静默回退 env */
export async function getJevMode(): Promise<JevModeValue> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.mode;
  let mode = envJevMode();
  try {
    const { rows } = await pool.query(`select value from app_config where key = 'jev_mode'`);
    const v = (rows[0]?.value as { mode?: string } | undefined)?.mode;
    if (v === "off" || v === "shadow" || v === "on") mode = v;
  } catch (e) {
    console.warn("[ai-mode] 读取覆盖失败，用 env 默认：", String(e).slice(0, 120));
  }
  cache = { mode, fetchedAt: Date.now() };
  return mode;
}

/** 保存 DB 覆盖并立即生效 */
export async function setJevMode(mode: JevModeValue, updatedBy: string): Promise<void> {
  await pool.query(
    `insert into app_config (key, value, updated_by, updated_at) values ('jev_mode', $1::jsonb, $2, now())
     on conflict (key) do update set value = $1::jsonb, updated_by = $2, updated_at = now()`,
    [JSON.stringify({ mode }), updatedBy],
  );
  invalidateAiMode();
}
