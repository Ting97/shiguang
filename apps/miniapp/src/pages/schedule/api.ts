/**
 * 日程页局部端点与类型（lib/api.ts 缺这些契约且禁止改，故按 README 铁律落页面目录）：
 * - 块：GET /api/blocks/range?from&to / POST /api/blocks / PATCH·DELETE /api/blocks/:id
 * - 聚合：GET /api/stats/range?from&to → {days:[{date,totalMin,byActivity}]}（月/年视图）
 * - 活动分类：GET·POST /api/activities / PATCH·DELETE /api/activities/:id
 * - todo：GET /api/todos?view=today|important|all|done → {todos,counts}；
 *   POST /api/todos / PATCH·DELETE /api/todos/:id / POST /api/todos/:id/decompose
 * - 空间：GET /api/spaces（todo 关联目标空间用，取 status=active）
 */
import { request } from "@/lib/request";

/* ---------- 类型（REQ-009 9-C 单源化：Activity/Block/TodoRow 与 shared/types 完全同构，改 re-export；
 * DayStat 是统计接口聚合形、TodoItem/Space/TodoView/TodoCounts 为本页消费形态，仍留此处） ---------- */

import type { Activity, Block, TodoRow } from "@shiguangri/shared";
export type { Activity, Block, TodoRow };

/** 单日聚合（统计接口，月/年视图） */
export interface DayStat {
  date: string; // YYYY-MM-DD
  totalMin: number;
  byActivity: Record<string, number>;
}

/** todo 树节点：行 + 一层行动 */
export interface TodoItem extends TodoRow {
  children: TodoRow[];
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: "active" | "archived";
}

export type TodoView = "today" | "important" | "all" | "done";
export type TodoCounts = Record<TodoView, number>;

/* ---------- 块（日/周视图） ---------- */

export const loadBlocksRange = (from: string, to: string) =>
  request<{ blocks: Block[]; hasExtras?: boolean }>(`/api/blocks/range?from=${from}&to=${to}`);

export const createBlock = (payload: { title: string; startAt: string; endAt: string; activityId: string }) =>
  request("/api/blocks", { method: "POST", body: payload });

export const patchBlock = (id: string, payload: Record<string, unknown>) =>
  request(`/api/blocks/${id}`, { method: "PATCH", body: payload });

export const deleteBlock = (id: string) =>
  request(`/api/blocks/${id}`, { method: "DELETE" });

/* ---------- 聚合（月/年视图） ---------- */

export const loadStatsRange = (from: string, to: string) =>
  // hasExtras：区间内是否有聚合外的明细（blocks/range 同款，供「去复盘」入口显隐）
  request<{ days: DayStat[]; hasExtras?: boolean }>(`/api/stats/range?from=${from}&to=${to}`);

/* ---------- 活动分类 ---------- */

export const loadActivities = () =>
  request<{ activities: Activity[] }>("/api/activities");

export const createActivity = (payload: { name: string; icon: string; color: string; defaultMin: number }) =>
  request("/api/activities", { method: "POST", body: payload });

export const patchActivity = (id: string, payload: Record<string, unknown>) =>
  request(`/api/activities/${id}`, { method: "PATCH", body: payload });

export const deleteActivity = (id: string) =>
  request(`/api/activities/${id}`, { method: "DELETE" });

/* ---------- todo ---------- */

export const loadTodosView = (view: TodoView) =>
  request<{ todos: TodoItem[]; counts?: TodoCounts }>(`/api/todos?view=${view}`);

export const createTodo = (payload: Record<string, unknown>) =>
  request<{ todo: { id: string; title: string } }>("/api/todos", { method: "POST", body: payload });

export const patchTodo = (id: string, body: Record<string, unknown>) =>
  request(`/api/todos/${id}`, { method: "PATCH", body });

export const deleteTodo = (id: string) =>
  request(`/api/todos/${id}`, { method: "DELETE" });

/** AI 拆解：todo → ≤10 行动；行动 → ≤3 同级细化。mode 仅在已有未完成行动时由菜单显式传入 */
export const decomposeTodo = (id: string, mode?: "replace" | "append") =>
  request<{ actions: unknown[] }>(`/api/todos/${id}/decompose`, { method: "POST", body: mode ? { mode } : {} });

/* ---------- 空间（关联目标用） ---------- */

export const loadSpaces = () =>
  request<{ spaces: Space[] }>("/api/spaces");

/* ---------- AI 复盘（review v3，= web app/calendar/review-card 那套） ----------
 * - 缓存：GET /api/review?kind=day|week|month|year&period=… → {review|null, generatedAt}
 *   只读已持久化结果，不触发 LLM、不耗次数。
 * - 生成：POST /api/review/day|week|month|year，body 分期传 {date}|{month}|{year} + refresh。
 *   失败语义：403 额度用尽 / 502 AI 解读失败，服务端中文 message 直接当徽标文案。
 */

export type ReviewKind = "day" | "week" | "month" | "year";

export interface ReviewBody {
  summary: string;
  sections?: { title: string; text: string }[];
  highlights?: string[];
  suggestions?: string[];
}

export const loadCachedReview = (kind: ReviewKind, period: string) =>
  request<{ review: ReviewBody | null; generatedAt: string | null }>(
    `/api/review?kind=${kind}&period=${period}`,
  );

export const generateReview = (
  kind: ReviewKind,
  period: string,
  refresh: boolean,
) => {
  // 各周期入参键名与服务端契约对齐：day/week 用 date，month 用 month，year 用 year
  const body = kind === "month" ? { month: period, refresh } : kind === "year" ? { year: period, refresh } : { date: period, refresh };
  return request<{ review: ReviewBody; generatedAt: string | null }>(`/api/review/${kind}`, {
    method: "POST",
    body,
    timeout: 60000, // LLM 同步生成耗时长：突破全局 20s 默认超时
  });
};
