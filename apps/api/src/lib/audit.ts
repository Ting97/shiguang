import { pool } from "@/lib/db";

/**
 * 通用 GLM 调用审计（成本监控）——所有 AI 消耗（parse/review/asr/chat）统一入 audit_logs。
 * 静默失败：审计写不进去不影响主流程。
 */
export interface AuditRecord {
  userId: string;
  entryId?: string | null;
  stage: "parse" | "review" | "asr" | "chat";
  model: string | null;
  engine?: string | null;
  latencyMs?: number | null;
  textLen?: number | null;
  ok: boolean;
  error?: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

export async function writeAuditRecord(r: AuditRecord): Promise<void> {
  try {
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
  } catch (e) {
    console.error("[audit] 写入失败:", e);
  }
}
