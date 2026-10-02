/**
 * 空间详情页局部端点（契约 grep 查证：apps/api/src/server/goal/service.ts + timeline/feed 路由）：
 * - 感悟：GET/POST /api/spaces/:id/reflections、GET/PATCH/DELETE /api/spaces/:id/reflections/:rid
 *   ⚠ 坑：lib/api.ts 的 loadSpaceReflections 返回类型标错（{reflections}，实际 {items,total}），
 *   该文件禁改，本页用局部封装。
 * - todo：GET /api/todos?view=all|done（web use-space-data 同款）、POST /api/todos {title,spaceId|parentId}、
 *   PATCH /api/todos/:id（done/undone/title/dueAt/activityId/note/repeatDaily/spaceId）、
 *   DELETE /api/todos/:id、POST /api/todos/:id/decompose {mode?:"replace"|"append"} → {actions:[]}
 * - 动态：GET /api/feed?spaceId=none（未归属池）、PATCH /api/feed/:id {spaceId}
 */
import { request } from "@/lib/request";

/* ---------- 感悟 ---------- */

/** 列表只回前 300 字预览（性能），chars 为全文长度 */
export interface ReflectionItem {
  id: string;
  preview: string;
  chars: number;
  created_at: string;
  updated_at?: string;
  edited?: boolean;
}

export function loadReflections(spaceId: string, limit = 20, offset = 0) {
  return request<{ items: ReflectionItem[]; total: number }>(
    `/api/spaces/${spaceId}/reflections?limit=${limit}&offset=${offset}`,
  );
}

export function getReflection(spaceId: string, rid: string) {
  return request<{ reflection: { content: string } }>(`/api/spaces/${spaceId}/reflections/${rid}`);
}

export function addReflection(spaceId: string, content: string) {
  return request(`/api/spaces/${spaceId}/reflections`, { method: "POST", body: { content } });
}

export function patchReflection(spaceId: string, rid: string, content: string) {
  return request(`/api/spaces/${spaceId}/reflections/${rid}`, { method: "PATCH", body: { content } });
}

export function deleteReflection(spaceId: string, rid: string) {
  return request(`/api/spaces/${spaceId}/reflections/${rid}`, { method: "DELETE" });
}

/* ---------- 关联 TODO·行动 ---------- */

/** 行结构（= shared TodoRow 的本页子集；view=all 已组装 children） */
export interface TodoRow {
  id: string;
  parent_todo_id: string | null;
  title: string;
  activity_id: string | null;
  activity_name: string | null;
  due_at: string | null;
  status: string;
  is_important: boolean;
  note: string | null;
  done_at: string | null;
  space_id: string | null;
  repeat_daily: boolean;
  repeat_done_count: number;
  kind: "todo" | "action";
}

export interface TodoItem extends TodoRow {
  children: TodoRow[];
}

/** view: today/important/all/done/today-actions（服务端 todoService.list） */
export function loadTodoView(view: "all" | "done") {
  return request<{ todos: TodoItem[] }>(`/api/todos?view=${view}`);
}

export function createTodo(body: { title: string; spaceId?: string; parentId?: string }) {
  return request("/api/todos", { method: "POST", body });
}

export function patchTodo(id: string, body: Record<string, unknown>) {
  return request(`/api/todos/${id}`, { method: "PATCH", body });
}

export function deleteTodo(id: string) {
  return request(`/api/todos/${id}`, { method: "DELETE" });
}

/** AI 拆解：待办→≤10 行动；行动→≤3 同级细化（插入其后）；mode=replace 清未完成重拆 */
export function decomposeTodo(id: string, mode?: "replace" | "append") {
  return request<{ actions: TodoRow[] }>(`/api/todos/${id}/decompose`, {
    method: "POST",
    body: mode ? { mode } : {},
  });
}

/* ---------- 关联动态 ---------- */

/** feed 行（= lib/api.FeedMoment 的本页子集） */
export interface SpaceMoment {
  id: string;
  raw_text: string;
  created_at: string;
}

/* ---------- 活动分类（行内编辑器分类下拉） ---------- */

export interface Activity {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** GET /api/activities（preset 含 id="other" 的「其他」；= web use-space-data 第五路并行请求） */
export function loadActivities() {
  return request<{ activities: Activity[] }>("/api/activities");
}

/** 未归属动态池（关联动态浮层数据源；q=原文关键字搜索，offset 翻页） */
export function loadUnlinkedFeed(limit = 20, offset = 0, q = "") {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset), spaceId: "none" });
  if (q) p.set("q", q);
  return request<{ moments: SpaceMoment[]; total?: number }>(`/api/feed?${p.toString()}`);
}

/** 把未归属动态关联到本空间 */
export function linkMoment(momentId: string, spaceId: string) {
  return request(`/api/feed/${momentId}`, { method: "PATCH", body: { spaceId } });
}
