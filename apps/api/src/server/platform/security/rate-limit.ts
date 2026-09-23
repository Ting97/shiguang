/**
 * 内存滑动窗口限流（REQ-004 FR-C1 / T2 的 IP 层）。
 * 单机部署假设成立；多实例时换 Redis/pg 实现（接口不变）。
 */
type Bucket = number[]; // 命中时间戳（ms）

const buckets = new Map<string, Bucket>();

/** 清理周期：每次命中时惰性清理过期桶（防 Map 无限膨胀）；阈值取所有已知窗口的最大值（写死 1h 会在更长窗口下提前清桶） */
const MAX_WINDOW_MS = Math.max(
  15 * 60_000, // login-guard IP 层
  60 * 60_000, // 预留：调用方窗口上限变化时同步此处
);
function sweep(now: number) {
  if (buckets.size < 512) return;
  for (const [k, arr] of buckets) {
    const alive = arr.filter((t) => now - t < MAX_WINDOW_MS);
    if (alive.length === 0) buckets.delete(k);
    else buckets.set(k, alive);
  }
}

export interface RateResult {
  blocked: boolean;
  /** 窗口内已命中次数 */
  hits: number;
  /** blocked 时：解封剩余毫秒 */
  retryAfterMs: number;
}

/** 只查不记：判断当前是否已达限流阈值（登录前置检查用——先查后记，成功登录不计入失败窗口） */
export function peekRateLimit(key: string, windowMs: number, max: number): RateResult {
  const now = Date.now();
  sweep(now);
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  const blocked = arr.length >= max;
  return {
    blocked,
    hits: arr.length,
    retryAfterMs: blocked ? Math.max(0, windowMs - (now - arr[0])) : 0,
  };
}

/** 命中一次限流键；窗口 windowMs 内超过 max 次后 blocked */
export function hitRateLimit(key: string, windowMs: number, max: number): RateResult {
  const now = Date.now();
  sweep(now);
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  const blocked = arr.length >= max;
  if (!blocked) arr.push(now);
  buckets.set(key, arr);
  return {
    blocked,
    hits: arr.length,
    retryAfterMs: blocked ? Math.max(0, windowMs - (now - arr[0])) : 0,
  };
}

/** 清空（测试用） */
export function resetRateLimits() {
  buckets.clear();
}
