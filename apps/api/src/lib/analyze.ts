import { pool, findOverlap, overlapError } from "@/lib/db";
import { parseInput } from "@shiguangri/ai";
import { inferGroupFromContext, inferInteractionType } from "@shiguangri/shared/social";
import { CONFIDENCE_THRESHOLD, type Domain } from "@shiguangri/ai";
import { writeAuditRecord } from "@/lib/audit";

/** 登记簿 upsert：每次识别写一行（entry+domain 唯一） */
export async function recordRecognition(
  client: import("pg").PoolClient,
  userId: string,
  entryId: string,
  domain: Domain,
  status: "applied" | "pending" | "none",
  result: unknown,
  confidence: number,
  engine: string,
) {
  await client.query(
    `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (entry_id, domain) do update set
       status = excluded.status, result = excluded.result,
       confidence = excluded.confidence, engine = excluded.engine, updated_at = now()`,
    [userId, entryId, domain, status, JSON.stringify(result ?? {}), confidence, engine],
  );
}

export interface AnalyzeOutcome {
  /** 日程与已有块冲突时的对块标题（null=无冲突） */
  conflictTitle: string | null;
  pendingDomains: string[];
  /** 与前端 toast 语义一致的 kind */
  kind: "todo" | "block" | "moment";
}

/** 解析审计（docs/06 欠账：引擎/模型/耗时/token → audit_logs 成本监控）；失败静默不影响主流程 */
async function writeAudit(
  userId: string,
  entryId: string,
  fields: {
    engine: string;
    model: string | null;
    durationMs: number;
    textLen: number;
    ok: boolean;
    error?: string;
    promptTokens?: number;
    completionTokens?: number;
  },
) {
  await writeAuditRecord({
    userId,
    entryId,
    stage: "parse",
    engine: fields.engine,
    model: fields.model,
    latencyMs: fields.durationMs,
    textLen: fields.textLen,
    ok: fields.ok,
    error: fields.error,
    promptTokens: fields.promptTokens,
    completionTokens: fields.completionTokens,
  });
}

/**
 * 对一条已存在的动态做完整五域识别并落库（发布后后台执行，也被确认/重识别复用）。
 * 心情直接回写 entries；识别结束（成功或失败）由调用方/finally 写 entries.analyzed_at。
 */
export async function analyzeAndPersist(userId: string, entryId: string, rawText: string): Promise<AnalyzeOutcome> {
  const startedAt = Date.now();
  let engine = "rules";
  let model: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  const client = await pool.connect();
  try {
    const r = await parseInput(rawText, {
      onUsage: (u) => {
        promptTokens = u.prompt_tokens;
        completionTokens = u.completion_tokens;
      },
    });
    engine = r.engine;
    if (r.engine === "llm") model = process.env.GLM_MODEL ?? "glm-4.7-flash";
    const pendingDomains: string[] = [];

    await client.query("begin");

    // 心情域：置信度足够才回写动态本体
    const moodOk = !!r.mood.label && r.mood.confidence >= CONFIDENCE_THRESHOLD;
    if (r.mood.label && moodOk) {
      await client.query(`update entries set mood = $2, mood_score = $3 where id = $1`, [entryId, r.mood.label, r.mood.score]);
    }
    if (r.mood.label && !moodOk) pendingDomains.push("mood");

    let conflictTitle: string | null = null;

    // ---- 日程域 ----
    if (r.intent === "todo") {
      await recordRecognition(client, userId, entryId, "schedule", "none", { reason: "未来计划不占时间轴" }, r.scheduleConfidence, r.engine);
    } else if (r.scheduleApplicable && r.scheduleConfidence >= CONFIDENCE_THRESHOLD) {
      const conflict = await findOverlap(userId, r.time.start, r.time.end);
      if (conflict) {
        // 冲突降级为纯动态（保留心情/金额/人物草稿），原因写登记簿供卡片展示
        conflictTitle = conflict.title;
        await recordRecognition(client, userId, entryId, "schedule", "none", { reason: overlapError(conflict) }, r.scheduleConfidence, r.engine);
        await recordRecognition(client, userId, entryId, "finance", r.finance.hasAmount ? (r.financeConfidence >= CONFIDENCE_THRESHOLD ? "applied" : "pending") : "none", r.finance, r.financeConfidence, r.engine);
        if (r.finance.hasAmount && r.financeConfidence >= CONFIDENCE_THRESHOLD) {
          await insertTransaction(client, userId, entryId, r, rawText);
        }
        await persistPeople(client, userId, entryId, r);
      } else {
        const block = (
          await client.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
            [userId, entryId, r.activity, r.title, r.time.start, r.time.end, r.time.mode],
          )
        ).rows[0];
        await recordRecognition(client, userId, entryId, "schedule", "applied", { blockId: block.id, title: r.title }, r.scheduleConfidence, r.engine);
      }
    } else if (r.scheduleApplicable) {
      pendingDomains.push("schedule");
    } else {
      await recordRecognition(client, userId, entryId, "schedule", "none", { reason: "无事件信号" }, r.scheduleConfidence, r.engine);
    }

    // ---- 待办域 ----
    // 进行中（已开始未结束）的显式区间：日程块照落，再补一条收尾待办（起始=区间起点，到期=区间终点）
    if (r.intent === "todo" || r.ongoing) {
      if (r.ongoing || r.todoConfidence >= CONFIDENCE_THRESHOLD) {
        const dueAt = r.ongoing ? r.time.end : r.time.start;
        const remind = new Date(new Date(dueAt).getTime() - 15 * 60_000);
        const todo = (
          await client.query(
            `insert into todos (user_id, entry_id, title, activity_id, start_at, due_at, remind_at, source)
             values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
            [userId, entryId, r.title, r.activity, r.time.start, dueAt, remind.toISOString()],
          )
        ).rows[0];
        await recordRecognition(client, userId, entryId, "todo", "applied", { todoId: todo.id, title: r.title, dueAt, startAt: r.time.start, ongoing: r.ongoing }, r.todoConfidence, r.engine);
      } else {
        pendingDomains.push("todo");
      }
    } else {
      await recordRecognition(client, userId, entryId, "todo", "none", { reason: "非未来计划" }, r.todoConfidence, r.engine);
    }

    // ---- 财务域（冲突路径已落过则跳过）----
    if (!conflictTitle) {
      if (r.finance.hasAmount && r.financeConfidence >= CONFIDENCE_THRESHOLD) {
        await insertTransaction(client, userId, entryId, r, rawText);
        await recordRecognition(client, userId, entryId, "finance", "applied", r.finance, r.financeConfidence, r.engine);
      } else if (r.finance.hasAmount) {
        pendingDomains.push("finance");
      } else {
        await recordRecognition(client, userId, entryId, "finance", "none", { reason: "无金额" }, r.financeConfidence, r.engine);
      }
      await persistPeople(client, userId, entryId, r);
    }

    // ---- 饮食域 ----
    if (r.diet.applicable && r.diet.confidence >= CONFIDENCE_THRESHOLD) {
      await client.query(
        `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
         values ($1,$2,$3,$4,$5)`,
        [userId, entryId, r.diet.meal, JSON.stringify(r.diet.items), r.diet.totalKcal ?? null],
      );
      await recordRecognition(client, userId, entryId, "diet", "applied", r.diet, r.diet.confidence, r.engine);
    } else if (r.diet.applicable) {
      pendingDomains.push("diet");
    } else {
      await recordRecognition(client, userId, entryId, "diet", "none", { reason: "无食物信号" }, r.diet.confidence, r.engine);
    }

    await client.query("commit");
    void writeAudit(userId, entryId, {
      engine, model, durationMs: Date.now() - startedAt, textLen: rawText.length, ok: true,
      promptTokens, completionTokens,
    });
    return {
      conflictTitle,
      pendingDomains,
      kind: r.intent === "todo" ? "todo" : r.intent === "schedule" ? "block" : "moment",
    };
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* 事务尚未开启（识别阶段失败）时忽略 */
    }
    void writeAudit(userId, entryId, {
      engine, model, durationMs: Date.now() - startedAt, textLen: rawText.length, ok: false, error: String(e).slice(0, 300),
      promptTokens, completionTokens,
    });
    throw e;
  } finally {
    client.release();
  }
}

/** 财务流水落库（主路径与冲突降级路径共用，保证只插一条） */
async function insertTransaction(
  client: import("pg").PoolClient,
  userId: string,
  entryId: string,
  r: import("@shiguangri/ai").ParseResult,
  rawText: string,
) {
  await client.query(
    `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      userId, entryId,
      r.finance.direction === "in" ? "in" : "out",
      Math.abs(r.finance.amountCents ?? 0),
      r.finance.category ?? "其他",
      r.finance.counterparty ?? null,
      rawText,
      r.time.end,
    ],
  );
}

/** 人际草稿：动态提到的人自动建档 + 记往来 */
async function persistPeople(
  client: import("pg").PoolClient,
  userId: string,
  entryId: string,
  r: import("@shiguangri/ai").ParseResult,
) {
  for (const p of r.people) {
    const c = (
      await client.query(
        `insert into contacts (user_id, name) values ($1, $2)
         on conflict (user_id, name) do update set name = excluded.name returning id`,
        [userId, p.name],
      )
    ).rows[0];
    const summary = p.event ? (p.event === r.title ? p.event : `${p.event}：${r.title}`) : r.title;
    await client.query(
      `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [userId, c.id, entryId, inferInteractionType(p.event), summary, r.time.end],
    );
  }
}
