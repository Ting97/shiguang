/**
 * 对话助手独立配额（REQ-015 批次 A）：free 每天按北京日 10 次，Pro/管理员不限。
 * 与 ai 域 30 次/30 天打卡配额（parse/review/asr）完全独立——对话是高频场景，
 * 混入口径会让 free 用户几次问答就把打卡识别额度烧光（已确认的产品决策）。
 * 计数口径：audit_logs 当日（北京日）stage='chat' 且 ok=true。
 */
import { pool } from "@/server/platform/db";
import { isProValid } from "@/server/ai";

/** 免费套餐：每个北京日（00:00–24:00）对话次数上限 */
export const FREE_CHAT_CALLS_PER_DAY = 10;

export interface ChatQuotaInfo {
  plan: "free" | "pro";
  /** 今日（北京时间）已用次数 */
  usedToday: number;
  /** 上限；null = 不限（Pro/管理员） */
  limit: number | null;
  planExpiresAt: string | null;
}

export async function getChatQuota(userId: string): Promise<ChatQuotaInfo> {
  const { rows } = await pool.query(`select plan, plan_expires_at, role from profiles where id = $1`, [userId]);
  const plan: string = rows[0]?.plan ?? "free";
  const expiresAt: string | null = rows[0]?.plan_expires_at ?? null;
  const pro = isProValid(plan, expiresAt);
  const unlimited = pro || rows[0]?.role === "admin";
  // 北京日界：now() at tz 'Asia/Shanghai' 得北京钟面 timestamp → date_trunc 取当日零点 → at tz 回 timestamptz
  const { rows: usedRows } = await pool.query(
    `select count(*)::int as n from audit_logs
     where user_id = $1
       and stage = 'chat' and ok
       and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`,
    [userId],
  );
  return {
    plan: pro ? "pro" : "free",
    usedToday: Number(usedRows[0]?.n ?? 0),
    limit: unlimited ? null : FREE_CHAT_CALLS_PER_DAY,
    planExpiresAt: expiresAt,
  };
}

/** 发消息前限流：不允许时调用方返回 402 */
export async function checkChatQuota(userId: string): Promise<ChatQuotaInfo & { allowed: boolean }> {
  const q = await getChatQuota(userId);
  return { ...q, allowed: q.limit === null || q.usedToday < q.limit };
}
