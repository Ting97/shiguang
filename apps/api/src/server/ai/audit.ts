import { pool } from "@/server/platform/db";
import { log } from "@/server/platform/http/logger";

/**
 * 通用 AI 调用审计（成本监控）——所有 AI 消耗（parse/review/asr/chat）统一入 audit_logs。
 * 4-B（FR-C3.1 / T5）：写失败不再纯静默——重试一次，仍失败输出结构化错误日志并累加连续失败计数
 * （/api/health 后续可消费该计数降级）。审计可靠性优先级高于零打扰，但绝不向调用方抛错。
 */
export interface AuditRecord {
  userId: string;
  entryId?: string | null;
  stage:
    | "parse"
    | "review"
    | "asr"
    | "chat"
    | "prompt_optimize"
    | "space_classify"
    | "decompose"
    | "prompt_preview"
    | "jev_shadow"
    | "admin_data"
    | "ai_profile";
  model: string | null;
  engine?: string | null;
  latencyMs?: number | null;
  textLen?: number | null;
  ok: boolean;
  error?: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

let consecutiveAuditFailures = 0;

/** 连续失败计数（健康检查降级信号用；成功写清零） */
export function auditHealth(): { consecutiveFailures: number } {
  return { consecutiveFailures: consecutiveAuditFailures };
}

async function insertAudit(r: AuditRecord) {
  await pool.query(
    `insert into audit_logs (user_id, entry_id, stage, model, engine, latency_ms, text_len, ok, error, prompt_tokens, completion_tokens)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      r.userId,
      r.entryId ?? null,
      r.stage,
      r.model ?? "",
      r.engine ?? null,
      r.latencyMs ?? null,
      r.textLen ?? null,
      r.ok,
      r.error ?? null,
      r.promptTokens ?? 0,
      r.completionTokens ?? 0,
    ],
  );
}

export async function writeAuditRecord(r: AuditRecord): Promise<void> {
  try {
    await insertAudit(r);
    if (consecutiveAuditFailures > 0) consecutiveAuditFailures = 0;
  } catch (first) {
    // 重试一次（短等）；仍失败 → 结构化错误可观测（不再纯静默）
    try {
      await new Promise((res) => setTimeout(res, 150));
      await insertAudit(r);
      consecutiveAuditFailures = 0;
    } catch (second) {
      consecutiveAuditFailures += 1;
      log.error(
        {
          stage: r.stage,
          entryId: r.entryId ?? null,
          consecutiveFailures: consecutiveAuditFailures,
          firstErr: String(first).slice(0, 120),
          secondErr: String(second).slice(0, 120),
        },
        "audit-write-failed",
      );
    }
  }
}
