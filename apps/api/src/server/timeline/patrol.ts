/**
 * 识别任务巡检补跑（REQ-004 FR-C2.4 / 威胁 T7）：
 * parse 的后台识别原为纯内存 Promise——进程重启/识别崩溃会让动态永远停在「识别中」。
 * 现在识别失败会留痕（analyzed_at=null + analyze_retries+1），巡检器周期扫描超时未完成的
 * 动态自动补跑（单条最多 3 次），standalone 常驻进程由 instrumentation 启动。
 */
import { pool } from "@/server/platform/db";
import { log } from "@/server/platform/http/logger";
import { analyzeAndPersist } from "./analyze";

const SCAN_INTERVAL_MS = 5 * 60_000;
const STALE_AFTER = "10 minutes";
const MAX_RETRIES = 3;
const BATCH = 5;

let running = false;

/** 扫描并补跑超时未完成识别的动态；返回本次补跑条数 */
export async function retryPendingAnalysis(): Promise<number> {
  if (running) return 0; // 上一轮未结束时跳过本轮（analyzeAndPersist 内部串行足够）
  running = true;
  try {
    const { rows } = await pool.query(
      `select id, user_id, raw_text from entries
       where analyzed_at is null
         and analyze_retries < $1
         and created_at < now() - $2::interval
       order by created_at
       limit $3`,
      [MAX_RETRIES, STALE_AFTER, BATCH],
    );
    let done = 0;
    for (const row of rows) {
      try {
        await analyzeAndPersist(row.user_id, row.id, row.raw_text);
        done += 1;
        log.info({ entryId: row.id }, "analyze-retry-ok");
      } catch (e) {
        await pool.query(`update entries set analyze_retries = analyze_retries + 1 where id = $1`, [row.id]);
        log.warn({ entryId: row.id, err: String(e).slice(0, 120) }, "analyze-retry-failed");
      }
    }
    return done;
  } finally {
    running = false;
  }
}

/**
 * 数据留存清扫（REQ-009 FR-F1，迁移 044）：
 * - audit_logs：明细保留 180 天；删除前按 用户×月×stage×模型×engine 上卷进 audit_logs_monthly（永久）
 * - sms/email 验证码、登录尝试、微信绑定票据：过期/陈旧行清理（此前未核销过期行永不清理）
 * 幂等：上卷 insert ... on conflict 累加，删除按时间窗推进，重复执行无副作用。
 */
export async function runRetentionSweep(): Promise<void> {
  // 上卷 180 天前、尚未归档的明细（按小时粒度去重执行：标记依据 = 明细被删除即不再出现）
  await pool.query(`
    with old as (
      delete from audit_logs
      where created_at < now() - interval '180 days'
      returning user_id, created_at, stage, model, engine, ok, prompt_tokens, completion_tokens
    )
    insert into audit_logs_monthly (user_id, month, stage, model, engine, calls, ok_calls, prompt_tokens, completion_tokens)
    select user_id,
           date_trunc('month', (created_at at time zone 'Asia/Shanghai'))::date,
           stage, coalesce(model, ''), coalesce(engine, ''),
           count(*)::int, count(*) filter (where ok)::int,
           coalesce(sum(prompt_tokens), 0), coalesce(sum(completion_tokens), 0)
    from old
    group by 1, 2, 3, 4, 5
    on conflict (user_id, month, stage, model, engine) do update set
      calls = audit_logs_monthly.calls + excluded.calls,
      ok_calls = audit_logs_monthly.ok_calls + excluded.ok_calls,
      prompt_tokens = audit_logs_monthly.prompt_tokens + excluded.prompt_tokens,
      completion_tokens = audit_logs_monthly.completion_tokens + excluded.completion_tokens`);
  // 过期验证码 / 陈旧登录尝试 / 过期绑定票据（表小，行数有界，直接清理）
  await pool.query(`delete from sms_codes where expires_at < now() - interval '1 day'`);
  await pool.query(`delete from email_codes where expires_at < now() - interval '1 day'`);
  await pool.query(`delete from login_attempts where created_at < now() - interval '30 days'`);
  await pool.query(`delete from wechat_bind_tickets where expires_at < now() - interval '1 day'`);
}

/** 启动周期巡检（instrumentation 调用；返回停止函数便于测试） */
export function startAnalysisPatrol(): void {
  const tick = async () => {
    try {
      // 顺带清理过期会话（idx_sessions_expiry 支撑；此前过期行只在被携带访问时惰性删一条，
      // 不再复访用户的会话永久累积）
      await pool.query(`delete from sessions where expires_at < now()`);
    } catch {
      /* 清理失败不影响主巡检 */
    }
    try {
      await runRetentionSweep();
    } catch (e) {
      log.warn({ err: String(e).slice(0, 120) }, "retention-sweep-error");
    }
    try {
      const n = await retryPendingAnalysis();
      if (n > 0) log.info({ retried: n }, "analysis-patrol");
    } catch (e) {
      log.warn({ err: String(e).slice(0, 120) }, "analysis-patrol-error");
    }
  };
  setInterval(tick, SCAN_INTERVAL_MS);
}
