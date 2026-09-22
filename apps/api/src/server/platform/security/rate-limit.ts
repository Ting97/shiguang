/**
 * 内存滑动窗口限流（REQ-004 FR-C1 / T2 的 IP 层）。
 * 单机部署假设成立；多实例时换 Redis/pg 实现（接口不变）。
 */
type Bucket = number[]; // 命中时间戳（ms）

const buckets = new Map<string, Bucket>();

/** 清理周期：每次命中时惰性清理过期桶（防 Map 无限膨胀） */
function sweep(now: number) {
  if (buckets.size < 512) return;
  for (const [k, arr] of buckets) {
    const alive = arr.filter((t) => now - t < 3_600_000);
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
