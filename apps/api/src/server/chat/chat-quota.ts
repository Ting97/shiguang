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
  // 已用口径：原子占位表与 audit_logs 计数取大者（占位含在途调用；审计兜迁移日前的当日历史）
  const dayKey = bjDayKey();
  const [usedRows, seatRows] = await Promise.all([
    pool.query(
      `select count(*)::int as n from audit_logs
       where user_id = $1
         and stage = 'chat' and ok
         and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`,
      [userId],
    ),
    pool.query(`select used from chat_daily_quotas where user_id = $1 and day_key = $2`, [userId, dayKey]),
  ]);
  return {
    plan: pro ? "pro" : "free",
    usedToday: Math.max(Number(usedRows.rows[0]?.n ?? 0), Number(seatRows.rows[0]?.used ?? 0)),
    limit: unlimited ? null : FREE_CHAT_CALLS_PER_DAY,
    planExpiresAt: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// 原子占位（并发修正）：check-then-act 在并发 N 条消息时全部读到同一计数、全部放行，
// 可无限超免费额度。与 insight/review-quota 同型：调用前占位 used+1（where used < lim），
// 失败回退。audit_logs 仍是计费事实源，本表只做配额判定与今日已用展示。
// ---------------------------------------------------------------------------

/** 占位时刻的北京日历日（UTC+8 后取 UTC getter，禁本地 getter） */
function bjDayKey(now = new Date()): string {
  const d = new Date(now.getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 发消息前原子占位一次。unlimited（Pro/管理员）不占位直接放行。 */
export async function acquireChatQuota(userId: string): Promise<ChatQuotaInfo & { allowed: boolean; dayKey: string }> {
  const q = await getChatQuota(userId);
  const dayKey = bjDayKey();
  if (q.limit === null) return { ...q, allowed: true, dayKey };
  const occupied = await pool.query(
    `insert into chat_daily_quotas (user_id, day_key, used) values ($1, $2, 1)
     on conflict (user_id, day_key) do update set used = chat_daily_quotas.used + 1, updated_at = now()
     where chat_daily_quotas.used < $3
     returning used`,
    [userId, dayKey, q.limit],
  );
  if (!occupied.rows[0]) return { ...q, allowed: false, dayKey };
  return { ...q, usedToday: occupied.rows[0].used, allowed: true, dayKey };
}

/** 调用失败回退占位（幂等，下限 0） */
export async function releaseChatQuota(userId: string, dayKey: string): Promise<void> {
  await pool.query(
    `update chat_daily_quotas set used = greatest(used - 1, 0), updated_at = now()
     where user_id = $1 and day_key = $2`,
    [userId, dayKey],
  );
}
