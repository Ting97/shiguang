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

/** 启动周期巡检（instrumentation 调用；返回停止函数便于测试） */
export function startAnalysisPatrol(): void {
  const tick = async () => {
    try {
      const n = await retryPendingAnalysis();
      if (n > 0) log.info({ retried: n }, "analysis-patrol");
    } catch (e) {
      log.warn({ err: String(e).slice(0, 120) }, "analysis-patrol-error");
    }
  };
  setInterval(tick, SCAN_INTERVAL_MS);
}
