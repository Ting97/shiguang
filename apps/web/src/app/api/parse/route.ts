import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/lib/db";import { getCurrentUser } from "@/lib/auth";
import { parseInput } from "@shiguangri/ai";
import { inferGroupFromContext, inferInteractionType } from "@/lib/social";
import { CONFIDENCE_THRESHOLD, type Domain } from "@shiguangri/ai";

export const runtime = "nodejs";

/** 登记簿 upsert：每次识别写一行（entry+domain 唯一） */
async function recordRecognition(
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

/**
 * POST /api/parse —— 一句话发动态：五域独立识别
 * schedule/todo/finance/mood 高置信直接落库；<0.6 的域写 pending 待确认；diet 同理
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text 必填" }, { status: 400 });
  }

  const pendingDomains: string[] = [];
  // 新建的日程块/待办要随响应返回（前端 toast 用；缺失会导致前端报「解析失败」）
  let createdBlock: Record<string, unknown> | null = null;
  let createdTodo: Record<string, unknown> | null = null;

  const client = await pool.connect();
  try {
    // 放进 try：解析异常时返回约定 JSON（前端能展示原因），而不是裸 500
    const r = await parseInput(text.trim());
    await client.query("begin");
    // 动态本体：记录时刻 created_at + AI 心情（心情域置信度足够才直接写）
    const moodOk = !!r.mood.label && r.mood.confidence >= CONFIDENCE_THRESHOLD;
    const entry = (
      await client.query(
        `insert into entries (user_id, source, raw_text, mood, mood_score)
         values ($1,'keyboard',$2,$3,$4) returning id, raw_text, mood, mood_score, created_at`,
        [user.id, text.trim(), moodOk ? r.mood.label : null, moodOk ? r.mood.score : null],
      )
    ).rows[0];
    if (r.mood.label && !moodOk) pendingDomains.push("mood");

    // ---- 日程域 ----
    if (r.intent === "todo") {
      await recordRecognition(client, user.id, entry.id, "schedule", "none", { reason: "未来计划不占时间轴" }, r.scheduleConfidence, r.engine);
    } else if (r.scheduleApplicable && r.scheduleConfidence >= CONFIDENCE_THRESHOLD) {
      const conflict = await findOverlap(user.id, r.time.start, r.time.end);
      if (conflict) {
        // 冲突降级为纯动态（保留心情/金额/人物草稿），把原因告诉用户
        await recordRecognition(client, user.id, entry.id, "schedule", "none", { reason: overlapError(conflict) }, r.scheduleConfidence, r.engine);
        await recordRecognition(client, user.id, entry.id, "finance", r.finance.hasAmount ? (r.financeConfidence >= CONFIDENCE_THRESHOLD ? "applied" : "pending") : "none", r.finance, r.financeConfidence, r.engine);
        // 财务/人际草稿照常落（与日程无关）
        await persistFinanceAndPeople(client, user.id, entry.id, r, text.trim());
        await client.query("commit");
        return NextResponse.json({
          kind: "moment", result: r, entry, conflict,
          conflictMessage: overlapError(conflict),
          pendingDomains: pendingDomains.filter((d) => d !== "mood"),
        });
      }
      const block = (
        await client.query(
          `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
           values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
          [user.id, entry.id, r.activity, r.title, r.time.start, r.time.end, r.time.mode],
        )
      ).rows[0];
      createdBlock = block;
      await recordRecognition(client, user.id, entry.id, "schedule", "applied", { blockId: block.id, title: r.title }, r.scheduleConfidence, r.engine);
    } else if (r.scheduleApplicable) {
      pendingDomains.push("schedule");
    } else {
      await recordRecognition(client, user.id, entry.id, "schedule", "none", { reason: "无事件信号" }, r.scheduleConfidence, r.engine);
    }

    // ---- 待办域 ----
    if (r.intent === "todo") {
      if (r.todoConfidence >= CONFIDENCE_THRESHOLD) {
        const remind = new Date(new Date(r.time.start).getTime() - 15 * 60_000);
        const todo = (
          await client.query(
            `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source)
             values ($1,$2,$3,$4,$5,$6,'keyboard') returning *`,
            [user.id, entry.id, r.title, r.activity, r.time.start, remind.toISOString()],
          )
          ).rows[0];
          createdTodo = todo;
          await recordRecognition(client, user.id, entry.id, "todo", "applied", { todoId: todo.id, title: r.title, dueAt: r.time.start }, r.todoConfidence, r.engine);
      } else {
        pendingDomains.push("todo");
      }
    } else {
      await recordRecognition(client, user.id, entry.id, "todo", "none", { reason: "非未来计划" }, r.todoConfidence, r.engine);
    }

    // ---- 财务域（草稿，Phase 2 确认流接管）----
    if (r.finance.hasAmount && r.financeConfidence >= CONFIDENCE_THRESHOLD) {
      await client.query(
        `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          user.id, entry.id,
          r.finance.direction === "in" ? "in" : "out",
          Math.abs(r.finance.amountCents ?? 0),
          r.finance.category ?? "其他",
          r.finance.counterparty ?? null,
          text.trim(),
          r.time.end,
        ],
      );
      await recordRecognition(client, user.id, entry.id, "finance", "applied", r.finance, r.financeConfidence, r.engine);
    } else if (r.finance.hasAmount) {
      pendingDomains.push("finance");
    } else {
      await recordRecognition(client, user.id, entry.id, "finance", "none", { reason: "无金额" }, r.financeConfidence, r.engine);
    }

    // ---- 人际草稿（沿用）----
    await persistFinanceAndPeople(client, user.id, entry.id, r, text.trim());

    // ---- 饮食域 ----
    if (r.diet.applicable && r.diet.confidence >= CONFIDENCE_THRESHOLD) {
      await client.query(
        `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
         values ($1,$2,$3,$4,$5)`,
        [user.id, entry.id, r.diet.meal, JSON.stringify(r.diet.items), r.diet.totalKcal ?? null],
      );
      await recordRecognition(client, user.id, entry.id, "diet", "applied", r.diet, r.diet.confidence, r.engine);
    } else if (r.diet.applicable) {
      pendingDomains.push("diet");
    } else {
      await recordRecognition(client, user.id, entry.id, "diet", "none", { reason: "无食物信号" }, r.diet.confidence, r.engine);
    }

    await client.query("commit");
    return NextResponse.json({
      kind: r.intent === "todo" ? "todo" : r.intent === "schedule" ? "block" : "moment",
      result: r, entry, block: createdBlock, todo: createdTodo, pendingDomains,
    });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

/** 财务冲突降级路径也要落人际草稿：抽出共用 */
async function persistFinanceAndPeople(
  client: import("pg").PoolClient,
  userId: string,
  entryId: string,
  r: import("@shiguangri/ai").ParseResult,
  rawText: string,
) {
  // 财务草稿（低置信 pending 由调用方决定；此处仅处理冲突路径的落库）
  if (r.finance.hasAmount && r.financeConfidence >= CONFIDENCE_THRESHOLD) {
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
