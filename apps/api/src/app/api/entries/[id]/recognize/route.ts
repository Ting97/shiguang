import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { parseInput, DOMAIN_LABELS, type Domain, type ParseResult } from "@shiguangri/ai";
import { inferInteractionType } from "@shiguangri/shared/social";
import { checkAiQuota } from "@/server/ai/quota";
import { writeAuditRecord } from "@/server/ai/audit";
import { getPromptBundle, assembleUserPrompt, type PromptKey } from "@/server/ai/prompts";
import { listContactNames } from "@/server/timeline/analyze";
import { toCstWallClock } from "@shiguangri/ai";

export const runtime = "nodejs";


const VALID = ["schedule", "todo", "finance", "mood", "diet", "people"] as const;

/**
 * POST /api/entries/:id/recognize { domain } —— 单域重新识别（替换式）
 * mood: 覆写/清空 | schedule: 冲突检测通过才换块 | todo/finance: 删旧落新 | diet: upsert
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const q = await checkAiQuota(user.id);
  if (!q.allowed) {
    return NextResponse.json(
      { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限识别`, quota: q },
      { status: 402 },
    );
  }
  const { id } = await ctx.params;
  const { domain } = (await req.json().catch(() => ({}))) as { domain?: string };
  if (!domain || !VALID.includes(domain as Domain | "people")) {
    return NextResponse.json(
      { error: "domain 需为 schedule/todo/finance/mood/diet/people" },
      { status: 400 },
    );
  }

  const entry = (
    await pool.query(`select id, raw_text from entries where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!entry) return NextResponse.json({ error: "动态不存在" }, { status: 404 });

  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  // 输入装配（3-A）：单域 key 按 DB 配置组装 user prompt；people 域联系人受开关控制
  const key = `extract_domain_${domain}` as PromptKey;
  const bundle = await getPromptBundle(key);
  const contactsOn = domain === "people" && bundle.config.inject.contactList;
  const contactNames = contactsOn ? await listContactNames(user.id, bundle.config.caps.contactCount) : undefined;
  const contactList =
    contactsOn && contactNames && contactNames.length
      ? `\n已有联系人（人物识别时称呼对齐到名单原文）：${contactNames.join("、")}`
      : "";
  const userPrompt = assembleUserPrompt(key, bundle, {
    nowCst: toCstWallClock(new Date()),
    contactList,
    text: entry.raw_text,
  });
  const r: ParseResult = await parseInput(entry.raw_text, {
    domain, // 单域专属提示词：只判本域，更准更省
    contactNames,
    systemPrompt: bundle.system,
    userPrompt,
    onUsage: (u) => {
      // 历史消耗口径：修复重问等多轮调用逐次累加，不取最后一次
      promptTokens += u.prompt_tokens;
      completionTokens += u.completion_tokens;
    },
  });
  // 整次重识别一行审计：tokens 为历次 LLM 调用合计（含修复重问）；降级但已耗 token 时如实归属模型
  void writeAuditRecord({
    userId: user.id, entryId: id, stage: "parse",
    model: r.engine !== "rules" || promptTokens > 0 ? process.env.GLM_MODEL ?? "glm-5.3-flash" : null,
    engine: r.engine,
    latencyMs: Date.now() - t0, ok: true,
    promptTokens, completionTokens,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    let applied = false;
    let result: unknown = null;
    let message = "";

    switch (domain) {
      case "mood": {
        applied = !!r.mood.label;
        result = r.mood;
        await client.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [
          applied ? r.mood.label : null,
          applied ? r.mood.score : null,
          id,
        ]);
        message = applied ? `😊 识别到心情：${r.mood.label}` : "未识别出心情，已清除原心情";
        break;
      }
      case "schedule": {
        if (!r.scheduleApplicable || r.intent === "todo") {
          // 识别不出：删旧块，动态变纯动态
          await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
          result = { reason: "未识别出日程" };
          message = "未识别出日程，已移除原日程块";
          break;
        }
        const conflict = await findOverlap(user.id, r.time.start, r.time.end);
        if (conflict) {
          await client.query("rollback");
          return NextResponse.json(
          { error: overlapError(conflict, { title: r.title, start: r.time.start, end: r.time.end }), conflict },
          { status: 409 },
        );
        }
        await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
        const block = (
          await client.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
            [user.id, id, r.activity, r.title, r.time.start, r.time.end, r.time.mode],
          )
        ).rows[0];
        applied = true;
        result = { blockId: block.id, title: r.title, startAt: r.time.start, endAt: r.time.end };
        message = `🕒 日程已更新：${r.title}`;
        break;
      }
      case "todo": {
        await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, user.id]);
        if (r.intent === "todo") {
          const remind = new Date(new Date(r.time.start).getTime() - 15 * 60_000);
          const todo = (
            await client.query(
              `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source, space_id)
               values ($1,$2,$3,$4,$5,$6,'keyboard',(select space_id from entries where id = $2)) returning id`,
              [user.id, id, r.title, r.activity, r.time.start, remind.toISOString()],
            )
          ).rows[0];
          applied = true;
          result = { todoId: todo.id, title: r.title };
          message = `📋 todo 已更新：${r.title}`;
        } else {
          result = { reason: "未识别出 todo" };
          message = "未识别出 todo，已移除原 todo";
        }
        break;
      }
      case "finance": {
        await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, user.id]);
        if (r.finance.hasAmount && r.finance.amountCents != null) {
          await client.query(
            `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              user.id, id,
              r.finance.direction === "in" ? "in" : "out",
              Math.abs(r.finance.amountCents),
              r.finance.category ?? "其他",
              r.finance.counterparty ?? null,
              entry.raw_text,
              r.time.end,
            ],
          );
          applied = true;
          result = r.finance;
          message = `💰 收支已更新：¥${(Math.abs(r.finance.amountCents) / 100).toFixed(0)}`;
        } else {
          result = { reason: "未识别出金额" };
          message = "未识别出收支，已移除原流水";
        }
        break;
      }
      case "diet": {
        await client.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [id, user.id]);
        if (r.diet.applicable && r.diet.items.length > 0) {
          await client.query(
            `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
             values ($1,$2,$3,$4,$5)`,
            [user.id, id, r.diet.meal, JSON.stringify(r.diet.items), r.diet.totalKcal ?? null],
          );
          applied = true;
          result = r.diet;
          const kcal = r.diet.totalKcal != null ? ` · ≈${r.diet.totalKcal} kcal` : "";
          message = `🍽 饮食已更新：${r.diet.meal}${kcal}`;
        } else {
          result = { reason: "未识别出饮食" };
          message = "未识别出饮食记录";
        }
        break;
      }
      case "people": {
        // 关系域：删旧往来，按解析结果重建（精确名/别名命中已有联系人则复用，避免称呼变体重建档）
        await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [id, user.id]);
        let added = 0;
        for (const p of r.people) {
          const hit = await client.query(
            `select id from contacts where user_id = $1 and (name = $2 or alias = $2) limit 1`,
            [user.id, p.name],
          );
          const contactId = hit.rows[0]
            ? hit.rows[0].id
            : (
                await client.query(
                  `insert into contacts (user_id, name) values ($1, $2)
                   on conflict (user_id, name) do update set name = excluded.name returning id`,
                  [user.id, p.name],
                )
              ).rows[0].id;
          const summary = p.event ? (p.event === r.title ? p.event : `${p.event}：${r.title}`) : r.title;
          await client.query(
            `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
             values ($1,$2,$3,$4,$5,$6)`,
            [user.id, contactId, id, inferInteractionType(p.event), summary, r.time.end],
          );
          added++;
        }
        applied = added > 0;
        result = { people: r.people };
        message = added > 0 ? `👥 关系已更新（${added} 人）` : "未识别出人物，已移除原关联";
        break;
      }
    }

    await client.query(
      `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (entry_id, domain) do update set
         status = excluded.status, result = excluded.result,
         confidence = excluded.confidence, engine = excluded.engine, updated_at = now()`,
      [user.id, id, domain, applied ? "applied" : "none", JSON.stringify(result ?? {}), confidenceOf(r, domain), r.engine],
    );

    await client.query("commit");
    return NextResponse.json({ ok: true, applied, domain, message: `${domain === "people" ? "关系" : DOMAIN_LABELS[domain as Domain]}：${message}` });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

function confidenceOf(r: ParseResult, domain: string): number {
  switch (domain) {
    case "people": return 0.9;
  }
  switch (domain as Domain) {
    case "schedule": return r.scheduleConfidence;
    case "todo": return r.todoConfidence;
    case "finance": return r.financeConfidence;
    case "mood": return r.mood.confidence;
    case "diet": return r.diet.confidence;
  }
  return 0.9;
}
