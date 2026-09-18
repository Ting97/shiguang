import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseInput, CONFIDENCE_THRESHOLD, DOMAIN_LABELS, type Domain, type ParseResult } from "@shiguangri/ai";

export const runtime = "nodejs";

const VALID: Domain[] = ["schedule", "todo", "finance", "mood", "diet"];

/**
 * POST /api/entries/:id/recognize { domain } —— 单域重新识别（替换式）
 * mood: 覆写/清空 | schedule: 冲突检测通过才换块 | todo/finance: 删旧落新 | diet: upsert
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const { domain } = (await req.json().catch(() => ({}))) as { domain?: Domain };
  if (!domain || !VALID.includes(domain)) {
    return NextResponse.json({ error: "domain 需为 schedule/todo/finance/mood/diet" }, { status: 400 });
  }

  const entry = (
    await pool.query(`select id, raw_text from entries where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!entry) return NextResponse.json({ error: "动态不存在" }, { status: 404 });

  const r: ParseResult = await parseInput(entry.raw_text);
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
          return NextResponse.json({ error: overlapError(conflict), conflict }, { status: 409 });
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
              `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source)
               values ($1,$2,$3,$4,$5,$6,'keyboard') returning id`,
              [user.id, id, r.title, r.activity, r.time.start, remind.toISOString()],
            )
          ).rows[0];
          applied = true;
          result = { todoId: todo.id, title: r.title };
          message = `📋 待办已更新：${r.title}`;
        } else {
          result = { reason: "未识别出待办" };
          message = "未识别出待办，已移除原待办";
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
              r.finance.amountCents < 0 ? "out" : "in",
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
    return NextResponse.json({ ok: true, applied, domain, message: `${DOMAIN_LABELS[domain]}：${message}` });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

function confidenceOf(r: ParseResult, domain: Domain): number {
  switch (domain) {
    case "schedule": return r.scheduleConfidence;
    case "todo": return r.todoConfidence;
    case "finance": return r.financeConfidence;
    case "mood": return r.mood.confidence;
    case "diet": return r.diet.confidence;
  }
}
