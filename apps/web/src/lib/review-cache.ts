import { pool } from "@/lib/db";

export interface Review {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * 复盘结果缓存：同一 (kind, period_key) 命中即秒回；refresh=true（用户点「重新生成」）时重调 LLM 并覆写。
 * 生成失败向上抛错由路由处理；缓存读写失败静默降级为直接生成。
 */
export async function getOrGenerateReview(
  userId: string,
  kind: "day" | "week" | "month" | "year",
  periodKey: string,
  refresh: boolean,
  generate: () => Promise<Review>,
): Promise<{ review: Review; cached: boolean }> {
  try {
    if (!refresh) {
      const hit = await pool.query(
        `select review from review_caches where user_id = $1 and kind = $2 and period_key = $3`,
        [userId, kind, periodKey],
      );
      if (hit.rows[0]) return { review: hit.rows[0].review as Review, cached: true };
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
  return { review, cached: false };
}
