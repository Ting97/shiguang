import { pool } from "@/server/platform/db";

/**
 * 复盘生成次数管控（review v3.1）。
 * 语义：上限=累计生成次数（日2/周5/月10/年24，初始给满）；实际可用受时间解锁约束：
 *   日（当天）20:00 前留 1 次；当前周周日晚 20:00 前留 2 次（可用3）；
 *   当月逐周 +2；当年逐月 +2；历史周期全开；管理员不限。
 * 数据有更新（latestDataAt 前移）bonus+1，可用 = min(上限, 时间解锁 + bonus) - used，
 * bonus 不提前解锁日/周的晚 8 点预留份额。
 */

export const REVIEW_LIMITS = { day: 2, week: 5, month: 10, year: 24, trade_week: 5, trading: 5 } as const;
export type ReviewKind = keyof typeof REVIEW_LIMITS;

const _UNLOCK_HOUR = 20; // 晚 8 点（北京时间）统一解锁点

// ---- 北京时间纯函数（UTC+8 手动偏移，用 getUTC* 读，不依赖服务器时区） ----
const bj = (ms = Date.now()) => new Date(ms + 8 * 3600_000);
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const ym = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
/** 某日期串（北京时间）当晚 20:00 对应的 UTC 毫秒 */
const eveningOf = (dateStr: string) => Date.parse(`${dateStr}T20:00:00+08:00`);

/** 当前时间下该周期键的时间解锁数；历史周期=上限，未来周期=0 */
export function timeCeiling(kind: ReviewKind, periodKey: string, nowMs = Date.now()): number {
  const M = REVIEW_LIMITS[kind];
  const now = bj(nowMs);
  const today = ymd(now);
  const monday = ymd(new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86_400_000));

  switch (kind) {
    case "day":
      if (periodKey < today) return M; // 历史日：全开
      if (periodKey > today) return 0; // 未来
      return nowMs < eveningOf(today) ? 1 : M; // 当天 20:00 前留 1 次
    case "week":
    case "trade_week":
    case "trading": {
      if (periodKey < monday) return M; // 历史周：全开
      if (periodKey > monday) return 0;
      const sunday = ymd(new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000));
      return nowMs < eveningOf(sunday) ? 3 : M; // 周日晚 20:00 前留 2 次
    }
    case "month": {
      const cur = ym(now);
      if (periodKey < cur) return M;
      if (periodKey > cur) return 0;
      // 当月已开始的自然周数（周一为周界；月初首周从 1 日起算）
      const [y, m] = cur.split("-").map(Number);
      const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
      const weeksStarted = Math.floor((now.getUTCDate() - 1 + firstDow) / 7) + 1;
      return Math.min(M, 2 * weeksStarted);
    }
    case "year": {
      const cur = String(now.getUTCFullYear());
      if (periodKey < cur) return M;
      if (periodKey > cur) return 0;
      return Math.min(M, 2 * now.getUTCMonth() + 2);
    }
  }
}

/** 次数门禁不通过：不是 AI 调用失败，不写审计（避免白占 30 天免费额度） */
export class ReviewGateError extends Error {
  readonly gate = true;
}

function gateMessage(kind: ReviewKind, periodKey: string, ceiling: number, M: number): string {
  const past = ceiling === M;
  switch (kind) {
    case "day":
      return past
        ? `该日小结生成次数已用完（上限 ${M} 次）`
        : `今日小结可用次数已用完（今日 20:00 后解锁第 ${M} 次）`;
    case "week":
    case "trade_week":
    case "trading":
      if (kind === "trade_week")
        return past
          ? `该周交易周报生成次数已用完（上限 ${M} 次）`
          : `本周交易周报可用次数已用完（周日晚 20:00 后解锁预留的 2 次）`;
      return past
        ? `该周小结生成次数已用完（上限 ${M} 次）`
        : `本周小结可用次数已用完（周日晚 20:00 后解锁预留的 2 次）`;
    case "month":
      return past
        ? `该月小结生成次数已用完（上限 ${M} 次）`
        : `本月小结可用次数已用完（逐周释放：每周解锁 2 次，已解锁 ${ceiling}/${M} 次）`;
    case "year":
      return past
        ? `该年小结生成次数已用完（上限 ${M} 次）`
        : `本年小结可用次数已用完（逐月释放：每月解锁 2 次，已解锁 ${ceiling}/${M} 次）`;
  }
}

export interface GateInfo {
  ok: boolean;
  /** 门禁通过时可用的剩余次数（管理员为 null） */
  remaining: number | null;
}

/** 管理员（profiles.role = 'admin'）不限次数 */
async function isAdminUser(userId: string): Promise<boolean> {
  const { rows } = await pool.query(`select role from profiles where id = $1`, [userId]);
  return rows[0]?.role === "admin";
}

/** 生成前检查并计提数据改动加成；不通过抛 ReviewGateError（由路由转 403） */
export async function acquireGeneration(
  userId: string,
  kind: ReviewKind,
  periodKey: string,
  latestDataAt: Date | null,
): Promise<GateInfo> {
  if (await isAdminUser(userId)) return { ok: true, remaining: null }; // 管理员不限

  const M = REVIEW_LIMITS[kind];
  await pool.query(
    `insert into review_gen_quotas (user_id, kind, period_key, last_data_at)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [userId, kind, periodKey, latestDataAt],
  );
  // 数据版本前移 → bonus+1（不设上限，可用数计算时统一 min(上限,…) 封顶）
  const { rows } = await pool.query(
    `update review_gen_quotas set
       bonus = case when $4::timestamptz is not null and (last_data_at is null or $4 > last_data_at)
                    then bonus + 1 else bonus end,
       last_data_at = case when $4::timestamptz is not null and (last_data_at is null or $4 > last_data_at)
                    then $4 else last_data_at end,
       updated_at = now()
     where user_id = $1 and kind = $2 and period_key = $3
     returning bonus, used`,
    [userId, kind, periodKey, latestDataAt],
  );
  // 日/周的晚 8 点预留是硬边界：bonus 只对月/年的进度解锁生效（trading 与 week 同为周日晚 20:00 口径，同列硬预留）
  const hardReserve = kind === "day" || kind === "week" || kind === "trade_week" || kind === "trading";
  const ceiling = timeCeiling(kind, periodKey);
  // 未来周期：时间解锁为 0，bonus 不参与——否则已排期 time_blocks 的 latest 前移可提前打开未来周期的次数
  if (ceiling === 0) {
    throw new ReviewGateError("该周期尚未开始，暂不可生成复盘");
  }
  const effectiveBonus = hardReserve ? 0 : rows[0].bonus;
  const available = Math.min(M, ceiling + effectiveBonus) - rows[0].used;
  if (available < 1) {
    throw new ReviewGateError(gateMessage(kind, periodKey, Math.min(ceiling, M), M));
  }
  return { ok: true, remaining: available };
}

/** 生成成功后消耗一次 */
export async function consumeGeneration(userId: string, kind: ReviewKind, periodKey: string): Promise<void> {
  if (await isAdminUser(userId)) return;
  await pool.query(
    `update review_gen_quotas set used = used + 1, updated_at = now()
     where user_id = $1 and kind = $2 and period_key = $3`,
    [userId, kind, periodKey],
  );
}
