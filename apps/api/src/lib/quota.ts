/**
 * AI 配额（M3 商业化）：免费用户按 30 天滚动窗口限 AI 识别次数，Pro 不限。
 * - AI 消耗口径与 /api/tokens/usage 一致：audit_logs 里的 parse/review/asr 全阶段
 * - 管理员（profiles.role = 'admin'）不受限
 * - plan_expires_at 到期自动回落 free（读取时判断，无需定时任务）
 */
import { pool } from "./db";

/** 免费套餐：30 天滚动窗口内 AI 调用上限 */
export const FREE_AI_CALLS_30D = 30;

export interface QuotaInfo {
  plan: "free" | "pro";
  /** 当前 30 天窗口已用次数 */
  used: number;
  /** 上限；null = 不限（Pro/管理员） */
  limit: number | null;
  planExpiresAt: string | null;
}

/** 套餐是否为有效 Pro（处理过期回落） */
export function isProValid(plan: string, planExpiresAt: string | Date | null): boolean {
  if (plan !== "pro") return false;
  if (!planExpiresAt) return true;
  return new Date(planExpiresAt).getTime() > Date.now();
}

export async function getQuota(userId: string): Promise<QuotaInfo> {
  const { rows } = await pool.query(
    `select plan, plan_expires_at, role from profiles where id = $1`,
    [userId],
  );
  const plan: string = rows[0]?.plan ?? "free";
  const expiresAt: string | null = rows[0]?.plan_expires_at ?? null;
  const pro = isProValid(plan, expiresAt);
  const unlimited = pro || rows[0]?.role === "admin";

  const { rows: usedRows } = await pool.query(
    `select count(*)::int as n from audit_logs
     where user_id = $1 and created_at > now() - interval '30 days'
       and coalesce(model, '') not like 'jev%'`,
    [userId],
  );
  const used = Number(usedRows[0]?.n ?? 0);
  return {
    plan: pro ? "pro" : "free",
    used,
    limit: unlimited ? null : FREE_AI_CALLS_30D,
    planExpiresAt: expiresAt,
  };
}

/** AI 入口限流检查：allowed=false 时调用方应返回 402 */
export async function checkAiQuota(userId: string): Promise<QuotaInfo & { allowed: boolean }> {
  const q = await getQuota(userId);
  return { ...q, allowed: q.limit === null || q.used < q.limit };
}
