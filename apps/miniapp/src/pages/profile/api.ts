/**
 * 「我的」页局部端点与类型（铁律 1：lib/api.ts 只 import 不改，缺的端点落页面目录）：
 * - fetchMeFull：lib 的 fetchMe 返回类型过窄（无 phone/createdAt/authDisabled），
 *   这里按服务端 identity/service.ts me() 的真实返回收窄全字段。
 * - PATCH /api/auth/profile（昵称 + 改密）、POST /api/auth/logout-all、
 *   GET /api/billing/plan：均无 lib 封装。
 */
import { request } from "@/lib/request";

/** GET /api/auth/me 全字段（= web profile 页 Me 接口 + modules） */
export interface Me {
  id: string;
  nickname: string | null;
  phone: string | null;
  authDisabled: boolean;
  isAdmin: boolean;
  modules: string[];
  phoneVerified: boolean;
  wechatBound: boolean;
  createdAt: string | null;
}

export function fetchMeFull() {
  return request<Me>("/api/auth/me");
}

/** PATCH /api/auth/profile：{nickname} 改昵称 / {currentPassword?, newPassword} 改密码 */
export function updateProfile(body: { nickname?: string; currentPassword?: string; newPassword?: string }) {
  return request<{ ok: true; nickname?: string; message?: string }>("/api/auth/profile", {
    method: "PATCH",
    body,
  });
}

/** POST /api/auth/logout-all：吊销本账号全部设备会话（4-B FR-C1.3，= web profile 同款） */
export function logoutAll() {
  return request<{ ok: true }>("/api/auth/logout-all", { method: "POST" });
}

/** GET /api/billing/plan：套餐 + 近 30 天 AI 用量 + 按模型 token 明细（M3 商业化） */
export interface PlanQuota {
  plan: string;
  used: number;
  limit: number | null;
  planExpiresAt: string | null;
  isAdmin: boolean;
  byModel?: {
    model: string;
    all: { calls: number; promptTokens: number; completionTokens: number };
    d30: { calls: number };
  }[];
}

export function loadPlan() {
  return request<PlanQuota>("/api/billing/plan");
}
