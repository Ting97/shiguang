import { pool, findOverlap, overlapError } from "@/server/platform/db";
import {
  parseInput, parseHybridInput, SpaceClassification, chat, jevAsk, jevEnabled,
  spaceClassifyQuestions, HybridUnavailableError, activeModel, extractJson,
} from "@shiguangri/ai";
import { assembleUserPrompt, getPromptBundle } from "@/server/ai/prompts";
import { ACTIVITY_NAMES, toCstWallClock } from "@shiguangri/ai";
import { inferInteractionType } from "@shiguangri/shared/social";
import { CONFIDENCE_THRESHOLD, type Domain } from "@shiguangri/ai";
import { writeAuditRecord } from "@/server/ai/audit";
import { jevShadowCompare } from "@/server/ai/jev-shadow";
import { getJevMode } from "@/server/ai/ai-mode";

/** 空间自动归属置信阈值（低于不写入） */
const SPACE_CONFIDENCE_THRESHOLD = 0.7;

/**
 * AI 空间归属（REQ-001 R3）：五域识别完成后，若有 active 空间则轻量分类一次；
 * 置信 ≥0.7 且 spaceId 在候选内 → 写入 entries.space_id 并让本动态的待办继承。
 * 失败静默（记 audit_logs stage='space_classify'），不影响主识别流程。
 */
async function classifySpace(userId: string, entryId: string, rawText: string): Promise<void> {
  try {
    const bundle = await getPromptBundle("space_classify");
    const { rows: spaces } = await pool.query(
      `select id, name, description from goal_spaces where user_id = $1 and status = 'active' order by sort limit ${bundle.config.caps.spaceCount}`,
      [userId],
    );
    if (spaces.length === 0) return; // 无 active 空间：跳过分类调用

    // 3-D：接管模式下空间分类整切 Jev（闭集 noul + choice）；失败静默回落下方 GLM 路径
    if ((await getJevMode()) === "on" && jevEnabled()) {
      try {
        const t0 = Date.now();
        const jevCandidates: Record<string, string> = {};
        for (const s of spaces) jevCandidates[s.id] = `${s.name}${s.description ? `：${s.description}` : ""}`;
        const state = `用户随口记录了一句话：\n「${rawText.slice(0, 500)}」`;
        const res = await jevAsk(state, spaceClassifyQuestions(jevCandidates));
        const belongs = res.answers["space_belongs"];
        const which = res.answers["space_which"];
        const pBelongs =
          belongs?.probabilities && typeof belongs.probabilities.true === "number" ? belongs.probabilities.true : null;
        const choice = typeof which?.value === "string" ? which.value : null;
        const confidence =
          choice && choice !== "__none__" ? which?.probabilities?.[choice] ?? which?.confidence ?? null : null;
        const accepted =
          pBelongs !== null &&
          pBelongs >= 0.5 &&
          choice !== null &&
          choice !== "__none__" &&
          confidence !== null &&
          confidence >= SPACE_CONFIDENCE_THRESHOLD &&
          spaces.some((s) => s.id === choice);
        if (accepted) {
          await pool.query(`update entries set space_id = $1 where id = $2 and user_id = $3`, [choice, entryId, userId]);
          await pool.query(`update todos set space_id = $1 where entry_id = $2 and user_id = $3 and space_id is null`, [
            choice, entryId, userId,
          ]);
        }
        void writeAuditRecord({
          userId, entryId, stage: "space_classify",
          model: process.env.JEV_MODEL ?? "jev-latest", engine: "space-classify-jev",
          latencyMs: Date.now() - t0, ok: true,
          error: accepted ? undefined : `skip: p=${pBelongs?.toFixed(2) ?? "null"} choice=${choice} conf=${confidence === null ? "null" : confidence.toFixed(2)}`,
        });
        return;
      } catch (e) {
        // Jev 调用失败：记审计后静默落回 GLM 分类（不进外层 catch——那里语义是「整体失败」）
        console.warn("[space-classify] Jev 归属失败，回落 GLM:", String(e).slice(0, 120));
        void writeAuditRecord({
          userId, entryId, stage: "space_classify",
          model: process.env.JEV_MODEL ?? "jev-latest", engine: "space-classify-jev",
          ok: false, error: String(e).slice(0, 200),
        });
      }
    }

    const candidates = spaces.map((s) => `- ${s.id}：${s.name}${s.description ? `（${s.description}）` : ""}`).join("\n");
    const userPrompt = assembleUserPrompt("space_classify", bundle, { candidates, text: rawText.slice(0, 500) });
    const t0 = Date.now();
    const raw = await chat({
      system: bundle.system,
      user: userPrompt,
      temperature: 0,
      maxTokens: 256,
      timeoutMs: 45_000,
    });
    const parsed = SpaceClassification.safeParse(extractJson(raw));
    if (!parsed.success) return;
    const { spaceId, confidence } = parsed.data;
    if (!spaceId || confidence < SPACE_CONFIDENCE_THRESHOLD) return;
    if (!spaces.some((s) => s.id === spaceId)) return; // spaceId 不在候选内：忽略

    await pool.query(`update entries set space_id = $1 where id = $2 and user_id = $3`, [spaceId, entryId, userId]);
    // 待办继承动态的空间（AI 从带空间动态识别出的待办自动归类）
    await pool.query(`update todos set space_id = $1 where entry_id = $2 and user_id = $3 and space_id is null`, [
      spaceId,
      entryId,
      userId,
    ]);
    void writeAuditRecord({
      userId, entryId, stage: "space_classify",
      model: activeModel(), engine: "space-classify",
      latencyMs: Date.now() - t0, ok: true,
    });
  } catch (e) {
    console.warn("[space-classify] 归属失败（静默忽略）:", String(e).slice(0, 160));
    void writeAuditRecord({
      userId, entryId, stage: "space_classify",
      model: activeModel(), engine: "space-classify",
      ok: false, error: String(e).slice(0, 300),
    });
  }
}

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

/** 以下常量/函数与五域识别编排相关（timeline 核心域，004 4-C 自 lib 迁入） */
/** 用户已有联系人名单（按最近往来排序，人物识别时供 AI 对齐称呼，条数上限由注入配置控制，默认 100） */
export async function listContactNames(userId: string, limit = 100): Promise<string[]> {
  const { rows } = await pool.query(
    `select c.name from contacts c
     left join (select contact_id, max(occurred_at) as last_at from interactions where user_id = $1 group by contact_id) i
       on i.contact_id = c.id
     where c.user_id = $1
     order by i.last_at desc nulls last, c.created_at desc
     limit $2`,
    [userId, limit],
  );
  return rows.map((r) => r.name).filter(Boolean);
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
 * 心情直接回写 entries；成功自写 entries.analyzed_at（失败留 null 供巡检补跑，FR-C2.4）。
 */
export async function analyzeAndPersist(userId: string, entryId: string, rawText: string): Promise<AnalyzeOutcome> {
  const startedAt = Date.now();
  let engine = "rules";
  let model: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  const client = await pool.connect();
  try {
    // 输入装配（3-A）：按 DB 配置开关/参数组装 user prompt；联系人注入关闭时不取数
    const bundle = await getPromptBundle("extract_full");
    const contactsOn = bundle.config.inject.contactList;
    const contactNames = contactsOn ? await listContactNames(userId, bundle.config.caps.contactCount) : [];
    const catList = bundle.config.inject.catList
      ? (Object.keys(ACTIVITY_NAMES) as (keyof typeof ACTIVITY_NAMES)[])
          .slice(0, bundle.config.caps.catCount)
          .map((k) => `${k}=${ACTIVITY_NAMES[k]}`)
          .join("、")
      : "";
    const contactList =
      contactsOn && contactNames.length
        ? `\n已有联系人（人物识别时称呼对齐到名单原文）：${contactNames.join("、")}`
        : "";
    const userPrompt = assembleUserPrompt("extract_full", bundle, {
      nowCst: toCstWallClock(new Date()),
      catList,
      contactList,
      text: rawText,
    });
    // 3-D：管理台模式 on 且 Jev 可用 → 混合引擎（Jev 闭集 + GLM 瘦身开放词汇）；
    // 混合任一环失败 → 回落全量 GLM（其内部再失败才 rules），降级链 Jev→GLM→rules 完整
    const mode = await getJevMode();
    const onUsage = (u: { prompt_tokens: number; completion_tokens: number }) => {
      // 历史消耗口径：修复重问等多轮调用逐次累加，不取最后一次
      promptTokens += u.prompt_tokens;
      completionTokens += u.completion_tokens;
    };
    const fullOpts = {
      contactNames: contactsOn ? contactNames : undefined,
      systemPrompt: bundle.system,
      userPrompt,
      onUsage,
    };
    const r =
      mode === "on" && jevEnabled()
        ? await (async () => {
            const slimBundle = await getPromptBundle("extract_open_vocab");
            const slimUserPrompt = assembleUserPrompt("extract_open_vocab", slimBundle, {
              nowCst: toCstWallClock(new Date()),
              contactList:
                slimBundle.config.inject.contactList && contactNames.length
                  ? `\n已有联系人（称呼对齐到名单原文）：${contactNames.join("、")}`
                  : "",
              text: rawText,
            });
            try {
              return await parseHybridInput(rawText, {
                contactNames: slimBundle.config.inject.contactList ? contactNames : undefined,
                slimSystemPrompt: slimBundle.system,
                slimUserPrompt,
                onUsage,
              });
            } catch (e) {
              const reason = e instanceof HybridUnavailableError ? e.reason : String(e).slice(0, 120);
              console.warn(`[ai] 混合引擎不可用（${reason}），回落全量 GLM，entry=${entryId}`);
              return parseInput(rawText, fullOpts);
            }
          })()
        : await parseInput(rawText, fullOpts);
    engine = r.engine;
    if (r.fallbackReason) console.warn(`[ai] 本次为规则降级（${r.fallbackReason}），entry=${entryId}`);
    // 规则兜底但 LLM 已被调用过（如输出不合格重问后仍失败）时也记模型名：token 消耗要如实归属
    if (r.engine !== "rules" || promptTokens > 0) model = activeModel();
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
        await recordRecognition(client, userId, entryId, "schedule", "none", { reason: overlapError(conflict, { title: r.title, start: r.time.start, end: r.time.end }) }, r.scheduleConfidence, r.engine);
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
    // FR-C2.4：成功才打 analyzed_at（失败留 null 供巡检补跑；调用方不再无脑 finally 打点）
    await pool.query(`update entries set analyzed_at = now() where id = $1 and analyzed_at is null`, [entryId]);
    void writeAudit(userId, entryId, {
      engine, model, durationMs: Date.now() - startedAt, textLen: rawText.length, ok: true,
      promptTokens, completionTokens,
    });
    // 空间归属（失败静默）：有 active 空间即发起轻量分类（依据是原文本身，与是否落库产物无关）
    void classifySpace(userId, entryId, rawText).catch(() => {});
    // Jev 影子对照（3-C：JEV_MODE=shadow 时与 GLM 结果逐闭集字段比对，仅审计，零用户影响）
    void jevShadowCompare(userId, entryId, rawText, r);
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

/** 人际草稿：动态提到的人自动建档 + 记往来（精确名/别名命中已有联系人则复用，避免称呼变体重建档） */
async function persistPeople(
  client: import("pg").PoolClient,
  userId: string,
  entryId: string,
  r: import("@shiguangri/ai").ParseResult,
) {
  for (const p of r.people) {
    // 先精确名/别名匹配（如识别出"王建军"而已有联系人"老王"的别名为它）
    const hit = await client.query(
      `select id, name from contacts where user_id = $1 and (name = $2 or alias = $2) limit 1`,
      [userId, p.name],
    );
    let contactId: string;
    if (hit.rows[0]) {
      contactId = hit.rows[0].id;
    } else {
      contactId = (
        await client.query(
          `insert into contacts (user_id, name) values ($1, $2)
           on conflict (user_id, name) do update set name = excluded.name returning id`,
          [userId, p.name],
        )
      ).rows[0].id;
    }
    const summary = p.event ? (p.event === r.title ? p.event : `${p.event}：${r.title}`) : r.title;
    await client.query(
      `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [userId, contactId, entryId, inferInteractionType(p.event), summary, r.time.end],
    );
  }
}
