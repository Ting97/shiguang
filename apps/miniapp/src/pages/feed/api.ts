/**
 * feed 页局部端点封装（README 约定：缺的端点在本页面目录建 api.ts，不改 src/lib/api.ts / request.ts）。
 * 以下契约均已 grep apps/api 源码核实，与猜测不同处在注释里标出。
 * 保留旧版数据链：POST /api/parse 文字落库拿 entryId → 并行上传 POST /api/entries/:id/images（单张失败重试一次）。
 */
import Taro from "@tarojs/taro";
import { API_BASE, ApiError, request } from "@/lib/request";
import { getSessionToken, toLogin } from "@/lib/session";

/* ---------- 动态流（GET /api/feed 返回的真实 camelCase 形态，源：server/timeline/service.ts listFeed SQL） ---------- */

export interface FeedTx {
  id: string;
  /** 可能是 string（pg numeric 序列化），比较/展示前必须 Number() */
  amountCents: number | string;
  direction: string;
  category: string;
  counterparty?: string | null;
}

export interface FeedTodo {
  id: string;
  title: string;
  startAt?: string | null;
  dueAt?: string | null;
  /** "done" 表示已完成——feed 里没有 done 布尔字段 */
  status?: string | null;
  activityId?: string | null;
}

export interface FeedBlock {
  id: string;
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  durationMin?: number | null;
  activityId?: string | null;
  activityName?: string | null;
  icon?: string | null;
  color?: string | null;
}

/** 人情（interactions）在 feed 里聚合成 people[]：「类型/摘要」在 summary */
export interface FeedPerson {
  interactionId: string;
  name: string;
  summary?: string | null;
}

/** feed 的 images 是 {storageKey} 对象数组（不是 URL 字符串） */
export interface FeedImageObj {
  id: string;
  storageKey: string;
  mime?: string;
  width?: number | null;
  height?: number | null;
  sort?: number;
}

/** 识别登记簿条目：status "applied" | "pending" | "none"；engine "rules" = 离线规则识别 */
export interface RecognitionInfo {
  status?: string;
  confidence?: number;
  reason?: string | null;
  engine?: string | null;
  reasonDismissed?: boolean;
}

/** feed 饮食域产物 */
export interface FeedDiet {
  id: string;
  meal: string;
  items: { name: string; amount?: string | null; kcal?: number | null }[] | null;
  totalKcal: number | null;
}

/** 页面级 FeedMoment：把 lib/api 里 unknown 的产物字段收窄成真实形态（字段名逐个对照 listFeed SQL） */
export interface FeedMomentFull {
  id: string;
  raw_text: string;
  source?: string | null;
  mood?: string | null;
  mood_score?: number | null;
  created_at: string;
  analyzed_at?: string | null;
  /** analyzed_at 为空且发布超 10 分钟 → "timeout"（前端停止转圈） */
  recognize_state?: string | null;
  space?: { id: string; name: string; icon: string; color: string } | null;
  blocks: FeedBlock[];
  todos: FeedTodo[];
  transactions: FeedTx[];
  people: FeedPerson[];
  diet: FeedDiet | null;
  images: FeedImageObj[];
  recognitions: Record<string, RecognitionInfo>;
}

export interface FeedPageResp {
  moments: FeedMomentFull[];
  total: number;
}

/** 动态流：limit 递增式分页（= web use-home-data：只加 limit 不用 offset，刷新后 total 驱动「还有 N 条」）；
 * before=历史回看锚点（ISO 时刻）：只取早于该时刻的动态，首条即锚点日的最后一条（= web 日期跳转） */
export function loadFeedPage(limit: number, q = "", spaceId = "all", before?: string | null) {
  const qs = [
    `limit=${limit}`,
    q ? `q=${encodeURIComponent(q)}` : "",
    spaceId !== "all" ? `spaceId=${spaceId}` : "",
    before ? `before=${encodeURIComponent(before)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  return request<FeedPageResp>(`/api/feed?${qs}`);
}

/* ---------- 动态本体操作 ---------- */

/**
 * 编辑原文（后端自动清旧产物并全域重识别）/ 修正心情 / 归属空间（三选一语义互斥）。
 * PATCH /api/feed/:id。
 */
export function patchFeedEntry(id: string, body: { raw_text?: string; mood?: string | null; spaceId?: string | null }) {
  return request<{ ok?: boolean }>(`/api/feed/${id}`, { method: "PATCH", body });
}

/** 关闭日程冲突警示条：POST /api/feed/:id/dismiss-conflict（服务端标记 reasonDismissed，多端持久） */
export function dismissConflict(id: string) {
  return request<{ ok?: boolean }>(`/api/feed/${id}/dismiss-conflict`, { method: "POST" });
}

/** 单域重新识别：POST /api/entries/:id/recognize { domain }（真实路由是 POST，已核实） */
export function recognizeEntryDomain(entryId: string, domain: string) {
  return request<{ message?: string }>(`/api/entries/${entryId}/recognize`, { method: "POST", body: { domain } });
}

/** 手动补充识别产物：POST /api/entries/:id/manual { domain, payload }（不经 AI） */
export function manualAddEntry(entryId: string, domain: string, payload: Record<string, unknown>) {
  return request<{ message?: string }>(`/api/entries/${entryId}/manual`, { method: "POST", body: { domain, payload } });
}

/**
 * 确认 / 忽略 pending 识别。契约核实：真实路由是 POST /api/entries/:id/confirm {domain, ignore?}。
 */
export function confirmEntry(entryId: string, domain: string, ignore = false) {
  return request<{ ok?: boolean }>(`/api/entries/${entryId}/confirm`, { method: "POST", body: { domain, ignore } });
}

/* ---------- 识别产物的行内编辑 / 删除 ---------- */

/** POST /api/blocks { title, startAt, endAt, activityId }（全部必填；409=时间重叠，error 文案服务端给） */
export function createBlock(body: { title: string; startAt: string; endAt: string; activityId: string }) {
  return request<{ block?: { id: string } }>(`/api/blocks`, { method: "POST", body });
}


/** PATCH /api/blocks/:id { title, startAt, endAt, activityId }（409=时间重叠，error 文案服务端给） */
export function patchBlock(id: string, body: { title?: string; startAt?: string; endAt?: string; activityId?: string }) {
  return request<{ ok?: boolean }>(`/api/blocks/${id}`, { method: "PATCH", body });
}

/** DELETE /api/blocks/:id */
export function deleteBlock(id: string) {
  return request<{ ok?: boolean }>(`/api/blocks/${id}`, { method: "DELETE" });
}

/** PATCH /api/todos/:id：done/undone/title/startAt/dueAt/activityId/today 全走这一个端点（web 同款） */
export function patchTodo(
  id: string,
  body: { done?: boolean; undone?: boolean; title?: string; startAt?: string | null; dueAt?: string | null; activityId?: string; today?: boolean },
) {
  return request<{ ok?: boolean }>(`/api/todos/${id}`, { method: "PATCH", body });
}

/** DELETE /api/todos/:id */
export function deleteTodo(id: string) {
  return request<{ ok?: boolean }>(`/api/todos/${id}`, { method: "DELETE" });
}

/** POST /api/todos：手动新增行动（今日行动清单「添加行动」行） */
export function createTodo(body: { title: string; kind?: string; today?: boolean }) {
  return request<{ id?: string }>(`/api/todos`, { method: "POST", body });
}

/** PATCH /api/transactions/:id { direction, amountCents, category, counterparty } */
export function patchTransaction(
  id: string,
  body: { direction: string; amountCents: number; category: string; counterparty: string },
) {
  return request<{ ok?: boolean }>(`/api/transactions/${id}`, { method: "PATCH", body });
}

/** DELETE /api/transactions/:id */
export function deleteTransaction(id: string) {
  return request<{ ok?: boolean }>(`/api/transactions/${id}`, { method: "DELETE" });
}

/** DELETE /api/interactions/:id（删除一条人情识别） */
export function deleteInteraction(id: string) {
  return request<{ ok?: boolean }>(`/api/interactions/${id}`, { method: "DELETE" });
}

/** DELETE /api/entries/:id/diet（删除饮食记录） */
export function deleteDiet(entryId: string) {
  return request<{ ok?: boolean }>(`/api/entries/${entryId}/diet`, { method: "DELETE" });
}

/* ---------- 首页其他区块 ---------- */

export interface Activity {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** GET /api/today 的时间块：这里是原生行（snake_case），与 feed 内嵌块（camelCase）不同，别混用 */
export interface TodayBlock {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  duration_min: number;
  activity_id: string;
  activity_name: string;
  icon: string;
  color: string;
  source?: string;
}

export interface TodayResp {
  todos?: unknown[];
  doneToday?: unknown[];
  blocks?: TodayBlock[];
  activities?: Activity[];
  todayKcal?: number;
}

/** GET /api/today：今日日程 / 活动类别 / 今日 kcal（= web use-home-data 的聚合接口） */
export function loadToday() {
  return request<TodayResp>("/api/today");
}

export interface SpaceRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: string;
}

/** GET /api/spaces：空间过滤条 / 归属菜单共用（只取 status=active，= web） */
export function loadActiveSpaces() {
  return request<{ spaces: SpaceRow[] }>("/api/spaces");
}

export interface TodayActionRow {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  note: string | null;
  kind: string;
  repeat_daily: boolean;
  repeat_done_count: number;
  parent_title: string | null;
  parent_due: string | null;
}

/** GET /api/todos?view=today-actions：首页今日行动清单（行动级条目 + 父待办上下文） */
export function loadTodayActions() {
  return request<{ actions: TodayActionRow[] }>("/api/todos?view=today-actions");
}

/* ---------- 图片（保留旧版数据链） ---------- */

/**
 * storageKey → 图片 URL。
 * 坑：GET /api/files/:key 是登录门禁路由（Bearer 头或 cookie 二选一），而 <Image> 组件带不了
 * Authorization 头——只能依赖登录响应写入的会话 cookie 由微信网络栈自动随请求携带
 * （wx.request / 图片加载共享 cookie jar）。若目标环境 cookie 丢失会 401 图裂，
 * 届时需后端支持 query token 或改 Taro.downloadFile 带 header 中转。
 */
export function fileUrl(storageKey: string): string {
  return `${API_BASE}/api/files/${storageKey}`;
}

export interface UploadImagesResp {
  ok?: true;
  images: { id: string; storageKey: string }[];
}

/**
 * 上传单张动态图片：POST /api/entries/:id/images（发布文字拿到 entryId 之后再调，与 web 同序）。
 * 契约核实：服务端 form.getAll("files") —— multipart 字段名是复数 files；
 * src/lib/request.ts 的 upload() 写死 name:"file"，直接用会 400「没有文件」，而 request.ts 禁改，
 * 故在此用 Taro.uploadFile 局部封装（鉴权头 / 401 跳登录 / 错误映射与 request.ts 同语义）。
 * 端点本身支持一次多文件，但 wx.uploadFile 一次只能带一个 → 并行多次单文件请求等价。
 * 服务端逐张校验：≤5MB、jpg/png/webp/gif 魔数、单条动态累计 ≤9 张。
 */
export function uploadEntryImage(entryId: string, filePath: string): Promise<UploadImagesResp> {
  const token = getSessionToken();
  return new Promise((resolve, reject) => {
    Taro.uploadFile({
      url: `${API_BASE}/api/entries/${entryId}/images`,
      filePath,
      name: "files", // 复数！服务端 getAll("files")，request.ts 的 upload() 写死 "file" 用不得
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 60000,
      success: (res) => {
        let data: UploadImagesResp & { error?: string };
        try {
          data = JSON.parse(res.data);
        } catch {
          reject(new ApiError("响应解析失败", res.statusCode));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else if (res.statusCode === 401) {
          toLogin();
          reject(new ApiError(data?.error || "未登录", 401));
        } else {
          reject(new ApiError(data?.error || `图片上传失败（${res.statusCode}）`, res.statusCode));
        }
      },
      fail: (err) => reject(new ApiError(err.errMsg || "网络异常", 0)),
    });
  });
}

/** 并行上传 + 失败自动重试一次；返回最终仍失败的本地路径（发布面板与补传共用） */
export async function uploadWithRetry(entryId: string, paths: string[]): Promise<string[]> {
  const attempt = (list: string[]) => Promise.allSettled(list.map((p) => uploadEntryImage(entryId, p)));
  const results = await attempt(paths);
  const failedOnce = paths.filter((_, i) => results[i].status === "rejected");
  if (!failedOnce.length) return [];
  // 瞬时网络抖动居多：自动重试一次，仍失败才留给用户手动重试
  const retry = await attempt(failedOnce);
  return failedOnce.filter((_, i) => retry[i].status === "rejected");
}
