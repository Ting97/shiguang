/**
 * 移动端 API 客户端：Bearer token（SecureStore 持久化）+ CORS 已在服务端放开。
 * 独立于 @shiguangri/shared（避免 monorepo TS 源码进 metro 的额外配置）。
 */
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "shiguang_token";
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://shiguang.ting97.cn";

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (token === null) await SecureStore.deleteItemAsync(TOKEN_KEY);
    else await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // 忽略存储异常（如模拟器缺 Keychain）：会话仅内存有效
  }
}

export interface QuotaInfo {
  plan: string;
  used: number;
  limit: number | null;
}

export class ApiError extends Error {
  status: number;
  quota: QuotaInfo | null;
  constructor(status: number, message: string, quota: QuotaInfo | null = null) {
    super(message);
    this.status = status;
    this.quota = quota;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const token = await getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init.body && typeof init.body === "string") headers["Content-Type"] = "application/json";
  const r = await fetch(API_BASE + path, { ...init, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const q = (j as { quota?: QuotaInfo }).quota ?? null;
    throw new ApiError(r.status, (j as { error?: string }).error ?? "请求失败", q);
  }
  const t = (j as { token?: unknown }).token;
  if (typeof t === "string" && t) await setToken(t); // 登录响应自动存 token
  return j as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/** 语音上传（multipart，native FormData 用 { uri, name, type }）；文件名/MIME 跟随录音实际格式 */
export function apiUpload<T>(path: string, fileUri: string): Promise<T> {
  const isM4a = fileUri.endsWith(".m4a") || fileUri.endsWith(".aac");
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: isM4a ? "voice.m4a" : "voice.wav",
    type: isM4a ? "audio/mp4" : "audio/wav",
  } as unknown as Blob);
  return request<T>(path, { method: "POST", body: form });
}

// —— 接口类型（仅移动端用到的字段） ——

export interface Moment {
  id: string;
  raw_text: string;
  mood: string | null;
  source: string;
  created_at: string;
  analyzed_at: string | null;
  blocks: { id: string; title: string }[];
  todos: { id: string; title: string }[];
  transactions: { id: string; amount_cents: number; direction: string }[];
}

/** 账号登录：含 @ 视为邮箱，否则手机号 */
export async function login(account: string, password: string): Promise<void> {
  const body = account.includes("@") ? { email: account, password } : { phone: account, password };
  await apiPost("/api/auth/login", body);
}

export async function loadFeed(): Promise<Moment[]> {
  const j = await apiGet<{ moments: Moment[] }>("/api/feed?limit=20");
  return j.moments ?? [];
}

export async function sendText(text: string): Promise<void> {
  await apiPost("/api/parse", { text });
}

export async function transcribe(fileUri: string): Promise<string> {
  const j = await apiUpload<{ text: string }>("/api/asr", fileUri);
  return j.text;
}
