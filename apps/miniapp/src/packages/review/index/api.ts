/**
 * 收支复盘页局部端点：周统计 + AI 周报（lib/api.ts 未封装这两个端点，按 README 约定局部补齐）。
 * 契约（grep apps/api/src/app/api/finance/stats/route.ts 与 finance/review/week/route.ts 确认）。
 */
import { request } from "@/lib/request";

/** GET /api/finance/stats?period=week&date= —— 周收支统计（纯 SQL，零 AI 消耗） */
export interface WeekStats {
  period: "day" | "week";
  date: string;
  range: { from: string; to: string };
  totals: { inCents: number; outCents: number; count: number };
  prev: { inCents: number; outCents: number }; // 上周同期，环比用
  byCategory: { category: string; cents: number; pct: number }[]; // 支出分类降序
  daily: { date: string; inCents: number; outCents: number }[]; // 周一~周日，缺失日补零
}

/** AI 周报正文：服务端截断 summary≤120 字、highlights≤3 条、suggestions≤2 条 */
export interface WeekReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/** GET 只读缓存：无缓存返回 {review:null}（不耗配额，进页面先走这个） */
export function getWeekReview(date: string) {
  return request<{ review: WeekReview | null; cached?: boolean; generatedAt?: string; range?: { from: string; to: string } }>(
    `/api/finance/review/week?date=${date}`,
  );
}

/** POST 生成/刷新：402 配额用尽 / 429 生成限频 / 503 未配置 AI —— body 为 {error: 中文文案}，request 层抛 ApiError(message) */
export function genWeekReview(date: string, refresh = true) {
  return request<{ review?: WeekReview; cached?: boolean; generatedAt?: string; range?: { from: string; to: string } }>(
    "/api/finance/review/week",
    { method: "POST", body: { date, refresh } },
  );
}

/** 周统计与周报都挂在 trade_review 模块门禁下：未开通 403「未开通该模块」 */
export function loadWeekStats(date: string) {
  return request<WeekStats>(`/api/finance/stats?period=week&date=${date}`);
}
