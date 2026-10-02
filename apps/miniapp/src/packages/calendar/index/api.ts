/**
 * 完整复盘页局部端点：只补「有无记录」判定所需的数据面（小结取数/生成在共享的
 * pages/schedule/review-card.tsx 内完成）：
 * - 块：GET /api/blocks/range?from&to → {blocks}（day/week 用，= web hasRecords 口径）
 * - 聚合：GET /api/stats/range?from&to → {days}（month/year 用）
 */
import { request } from "@/lib/request";

export const loadBlocksRange = (from: string, to: string) =>
  request<{ blocks: unknown[] }>(`/api/blocks/range?from=${from}&to=${to}`);

export const loadStatsRange = (from: string, to: string) =>
  request<{ days: unknown[] }>(`/api/stats/range?from=${from}&to=${to}`);
