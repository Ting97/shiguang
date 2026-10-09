import { pool } from "@/server/platform/db";
import { activeModel } from "@shiguangri/ai";
import { writeAuditRecord } from "@/server/ai/audit";

export interface Review {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * 复盘结果缓存：同一 (kind, period_key) 命中即秒回；refresh=true（用户点「重新生成」）时重调 LLM 并覆写。
 * latestDataAt：该周期内最新一条记录的时间——缓存生成后又有新记录则视为过期，自动重新生成。
 * 生成失败向上抛错由路由处理；缓存读写失败静默降级为直接生成。
 * generate 接收 capture 回调（传给 glm.chat 的 onUsage），成功/失败均写 stage='review' 审计（token 成本监控）。
 */
export async function getOrGenerateReview(
  userId: string,
  kind: "day" | "week" | "month" | "year" | "trade_week" | "trading",
  periodKey: string,
  refresh: boolean,
  latestDataAt: Date | null,
  generate: (capture: (usage: { prompt_tokens: number; completion_tokens: number }) => void) => Promise<Review>,
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

  const startedAt = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let review: Review;
  try {
    review = await generate((u) => {
      // 历史消耗口径：多轮调用逐次累加，不取最后一次
      promptTokens += u.prompt_tokens;
      completionTokens += u.completion_tokens;
    });
  } catch (e) {
    // 次数门禁拒绝不是 AI 调用：不写审计（免占免费额度），直接抛给路由转 403
    if ((e as { gate?: boolean }).gate === true) throw e;
    void writeAuditRecord({
      userId,
      stage: "review",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: String(e).slice(0, 300),
    });
    throw e;
  }
  void writeAuditRecord({
    userId,
    stage: "review",
    model: activeModel(),
    latencyMs: Date.now() - startedAt,
    ok: true,
    promptTokens,
    completionTokens,
  });

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

/**
 * 删除周期内记录后失效该发生日覆盖的四档小结缓存（day/week/month/year）。
 * 删除会让 max(occurred_at) 水位回退、缓存被判「仍新鲜」——buildLatest 的 updated_at 水位
 * 只能覆盖编辑/转正（行还在），覆盖不了删除（行没了），必须显式清。
 */
export async function invalidateReviewCachesForOccurrence(userId: string, occurredAt: Date): Promise<void> {
  try {
    // 北京日历日（UTC getter + 8h，禁本地 getter）
    const d = new Date(occurredAt.getTime() + 8 * 3600_000);
    if (Number.isNaN(d.getTime())) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dayKey = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    // 该日所在周的周一（北京日历周，与 review 路由 week 键一致）
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
    const weekKey = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
    const monthKey = dayKey.slice(0, 7);
    const yearKey = dayKey.slice(0, 4);
    await pool.query(
      `delete from review_caches
       where user_id = $1
         and (kind, period_key) in (('day',$2),('week',$3),('month',$4),('year',$5),('trade_week',$3))`,
      [userId, dayKey, weekKey, monthKey, yearKey],
    );
  } catch (e) {
    console.error("[review-cache] 失效失败（降级为可能旧缓存）:", e);
  }
}
