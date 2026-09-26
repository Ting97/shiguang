/**
 * 日历复盘页局部端点（apps/api 契约已 grep 查证）：
 * - 日小结缓存：GET /api/review?kind=day&period=YYYY-MM-DD → {review|null, generatedAt}
 *   只读已持久化结果，不触发 LLM、不耗次数（apps/api/src/app/api/review/route.ts）。
 * - 生成/刷新：POST /api/review/day {date, refresh?} —— 注意是 POST 不是 GET，
 *   body 传 {date}；返回 {review:{summary,highlights,suggestions}, cached, generatedAt, facts}。
 *   失败语义：400 日期非法 / 403 额度用尽（ReviewGateError）/ 502 AI 解读失败
 *   （apps/api/src/app/api/review/day/route.ts）。
 * lib/api.ts 未收录这两个端点且禁止改该文件，故落在本页局部。
 */
import { request } from "@/lib/request";

export interface DayReview {
  summary: string;
  highlights?: string[];
  suggestions?: string[];
}

export function loadCachedDayReview(date: string) {
  return request<{ review: DayReview | null; generatedAt: string | null }>(
    `/api/review?kind=day&period=${date}`,
  );
}

export function generateDayReview(date: string, refresh: boolean) {
  return request<{ review: DayReview; cached: boolean; generatedAt: string | null }>(
    "/api/review/day",
    { method: "POST", body: { date, refresh } },
  );
}
