import { pool } from "@/lib/db";

export interface Review {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * 复盘结果缓存：同一 (kind, period_key) 命中即秒回；refresh=true（用户点「重新生成」）时重调 LLM 并覆写。
 * latestDataAt：该周期内最新一条记录的时间——缓存生成后又有新记录则视为过期，自动重新生成。
 * 生成失败向上抛错由路由处理；缓存读写失败静默降级为直接生成。
 */
export async function getOrGenerateReview(
  userId: string,
  kind: "day" | "week" | "month" | "year",
  periodKey: string,
  refresh: boolean,
  latestDataAt: Date | null,
  generate: () => Promise<Review>,
): Promise<{ review: Review; cached: boolean; generatedAt: string }> {
  let cachedHit: Review | null = null;
  let cachedAt: Date | null = null;
  let cacheFresh = false;
  try {
    if (!refresh) {
      const hit = await pool.query(
        `select review, updated_at from review_caches where user_id = $1 and kind = $2 and period_key = $3`,
        [userId, kind, periodKey],
      );
      if (hit.rows[0]) {
        cachedHit = hit.rows[0].review as Review;
        cachedAt = new Date(hit.rows[0].updated_at);
        // 数据新鲜度：缓存生成后周期内没有新记录才算有效
        cacheFresh = latestDataAt == null || cachedAt >= latestDataAt;
        if (cacheFresh) return { review: cachedHit, cached: true, generatedAt: cachedAt.toISOString() };
      }
    }
  } catch (e) {
    console.error("[review-cache] 读取失败:", e);
  }

  const review = await generate();

  try {
    await pool.query(
      `insert into review_caches (user_id, kind, period_key, review)
       values ($1,$2,$3,$4)
       on conflict (user_id, kind, period_key)
       do update set review = excluded.review, updated_at = now()`,
      [userId, kind, periodKey, JSON.stringify(review)],
    );
  } catch (e) {
    console.error("[review-cache] 写入失败:", e);
  }
  return { review, cached: false, generatedAt: new Date().toISOString() };
}
