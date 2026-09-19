/**
 * 三端共用 fetch 封装。
 * - Web 同域：直接用，cookie 自动携带（与旧版行为完全兼容）
 * - 原生端（Expo/Capacitor 本地包）：跨 origin 访问 API，走 Bearer token + CORS；
 *   token 存储由各端注入（web localStorage / Expo SecureStore / Capacitor Preferences）
 * - API_BASE：同域留空；分离部署时经环境变量注入（Web=NEXT_PUBLIC_API_BASE，Expo=EXPO_PUBLIC_API_BASE）
 */

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

const memory: { token: string | null } = { token: null };

/** 兜底存储：仅内存（App 重启丢会话，建议宿主注入正式实现） */
export const memoryTokenStore: TokenStore = {
  async get() {
    return memory.token;
  },
  async set(token) {
    memory.token = token;
  },
};

/** Web localStorage 实现 */
export const localStorageTokenStore: TokenStore = {
  async get() {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("shiguang_token");
  },
  async set(token) {
    if (typeof window === "undefined") return;
    if (token === null) window.localStorage.removeItem("shiguang_token");
    else window.localStorage.setItem("shiguang_token", token);
  },
};

let store: TokenStore = typeof window !== "undefined" ? localStorageTokenStore : memoryTokenStore;

/** 宿主注入正式 token 存储（Expo SecureStore 等），应在应用启动时调用一次 */
export function setTokenStore(s: TokenStore): void {
  store = s;
}

function apiBase(): string {
  // Next/Expo 分别在构建期内联自己的 PUBLIC_ 变量；无打包器的环境落到 ""
  if (typeof process !== "undefined" && process.env) {
    return process.env.NEXT_PUBLIC_API_BASE || process.env.EXPO_PUBLIC_API_BASE || "";
  }
  return "";
}

/** 登录/注册等响应体里的 token 自动入库；传 null 清除（登出/401） */
export async function setSessionToken(token: string | null): Promise<void> {
  await store.set(token);
}

export async function getSessionToken(): Promise<string | null> {
  return store.get();
}

/** 非任意包一层 fetch：可选 JSON body；返回解析后的 JSON（默认 any——历史调用点直接取字段） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(url: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = await store.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const r = await fetch(apiBase() + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) await store.set(null); // 会话失效即清 token
    throw new Error((j as { error?: string }).error ?? "操作失败");
  }
  // 登录/注册/setup 响应附带 token：自动入库，后续请求带 Bearer
  const t = (j as { token?: unknown }).token;
  if (typeof t === "string" && t) await store.set(t);
  return j as T;
}
