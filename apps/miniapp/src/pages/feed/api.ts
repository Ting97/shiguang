/**
 * feed 页局部端点封装（README 约定：缺的端点在本页面目录建 api.ts，不改 src/lib/api.ts / request.ts）。
 * 以下契约均已 grep apps/api / apps/web 源码核实，与任务书猜测不同处在注释里标出。
 */
import Taro from "@tarojs/taro";
import { API_BASE, ApiError, request } from "@/lib/request";
import { getSessionToken, toLogin } from "@/lib/session";

/* ---------- 识别产物（GET /api/feed 返回的真实 camelCase 形态，源：server/timeline/service.ts listFeed SQL） ---------- */

export interface FeedTx {
  id: string;
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
}

export interface FeedBlock {
  id: string;
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  durationMin?: number | null;
  activityName?: string | null;
}

/** 人情（interactions）在 feed 里聚合成 people[]：无独立 interactions 字段，「类型/摘要」在 summary */
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

/** 识别登记簿条目：status === "pending" 才需要用户确认（对齐 web pending-confirms.tsx 口径） */
export interface RecognitionInfo {
  status?: string;
  confidence?: number;
  reason?: string;
  engine?: string;
  reasonDismissed?: boolean;
}

/* ---------- 待确认 ---------- */

/**
 * 确认 / 忽略 pending 识别。
 * 契约核实：真实路由是 POST /api/entries/:id/confirm {domain, ignore?}
 * （apps/api/src/app/api/entries/[id]/confirm/route.ts 只导出 POST）——任务书猜的 PATCH 并不存在，按真实契约用 POST。
 */
export function confirmEntry(entryId: string, domain: string, ignore = false) {
  return request<{ ok?: boolean }>(`/api/entries/${entryId}/confirm`, { method: "POST", body: { domain, ignore } });
}

/* ---------- 图片 ---------- */

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
 * 端点本身支持一次多文件，但 wx.uploadFile 一次只能带一个 → 并行多次单文件请求等价
 * （贴近 9 张上限时有微小并发超发窗口，调用方已按「剩余可传数」截断，正常使用不触达）。
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
