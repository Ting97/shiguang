/**
 * 交易页局部端点：digest 摘要 + AI 复盘生成（lib/api.ts 只有 GET 缓存的 loadTradingReview，
 * digest 与 POST 生成均缺，按 README 约定局部补齐；账号/日盈亏/权益/逐笔仍用 lib 现成函数）。
 * 契约（grep apps/api/src/app/api/trading/digest/route.ts、review/route.ts 与
 * apps/api/src/server/finance/trading/trades-review.ts 确认）。注意：交易金额是 USD 原币数值，不是分。
 */
import { request } from "@/lib/request";

export interface DigestAggRow {
  bucket: string; // morning/afternoon/evening/lateNight | lt15m/m15to60/h1to4/gt4h | buy/sell
  count: number;
  net: number;
}
export interface TradingDigest {
  accountId: string;
  stats: {
    totalTrades: number;
    totalNet: number;
    peak: { ymd: string; cum: number } | null;
    drawdowns: { startYmd: string; endYmd: string; troughYmd: string; amount: number }[];
    phases: {
      beforePeak: { count: number; net: number; winRate: number | null };
      afterPeak: { count: number; net: number; winRate: number | null };
    };
  };
  aggregations: { byPeriod: DigestAggRow[]; byDuration: DigestAggRow[]; byDirection: DigestAggRow[] };
  notable: { label: string; ticket: string; symbol: string; direction: string; lots: number; netProfit: number; closeTime: string }[];
  facts: string;
}

/** GET /api/trading/digest?accountId —— 规则统计素材（零 LLM，页面常显） */
export function loadTradingDigest(accountId: string) {
  return request<TradingDigest>(`/api/trading/digest?accountId=${accountId}`);
}

export interface TradingReviewBody {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/** POST /api/trading/review {accountId, refresh} —— 生成 AI 复盘（走配额；缓存命中秒回）。
 * 两条出路：正常 {review, cached?, generatedAt?, digest}；降级 {fallback:true, fallbackReason, digest}
 * （402 配额 / 429 限频 / 502、503 上游时服务端不抛错，改为返回规则版 digest 兜底）。 */
export function genTradingReview(accountId: string, refresh = true) {
  return request<{
    review?: TradingReviewBody;
    cached?: boolean;
    generatedAt?: string;
    fallback?: boolean;
    fallbackReason?: string;
    digest?: TradingDigest | null;
  }>("/api/trading/review", { method: "POST", body: { accountId, refresh } });
}
