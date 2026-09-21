import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type Domain = "schedule" | "todo" | "finance" | "mood" | "diet";

/** POST /api/entries/:id/confirm { domain, ignore? } —— 确认 pending 结果落库；ignore=true 则丢弃该识别 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const { domain, ignore = false } = (await req.json().catch(() => ({}))) as { domain?: Domain; ignore?: boolean };

  const rec = (
    await pool.query(
      `select id, result from entry_recognitions
       where entry_id = $1 and user_id = $2 and domain = $3 and status = 'pending'`,
      [id, user.id, domain],
    )
  ).rows[0];
  if (!rec) return NextResponse.json({ error: "没有待确认的识别结果" }, { status: 404 });

  if (ignore) {
    await pool.query(`update entry_recognitions set status = 'none', updated_at = now() where id = $1`, [rec.id]);
    return NextResponse.json({ ok: true, domain, ignored: true });
  }

  const result = rec.result ?? {};
  const client = await pool.connect();
  try {
    await client.query("begin");
    const entry = (
      await pool.query(`select raw_text from entries where id = $1 and user_id = $2`, [id, user.id])
    ).rows[0];
    if (!entry) {
      await client.query("rollback");
      return NextResponse.json({ error: "动态不存在" }, { status: 404 });
    }

    switch (domain) {
      case "mood": {
        if (result.label) {
          await pool.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [
            result.label, result.score ?? 0, id,
          ]);
        }
        break;
      }
      case "schedule": {
        if (result.startAt && result.endAt && result.activityId && result.title) {
          await pool.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [id, user.id]);
          await pool.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,'default','keyboard')`,
            [user.id, id, result.activityId, result.title, result.startAt, result.endAt],
          );
        }
        break;
      }
      case "todo": {
        if (result.dueAt && result.title) {
          await pool.query(`delete from todos where entry_id = $1 and user_id = $2`, [id, user.id]);
          await pool.query(
            `insert into todos (user_id, entry_id, title, due_at, remind_at, source, space_id)
             values ($1,$2,$3,$4,$5,'keyboard',(select space_id from entries where id = $2))`,
            [user.id, id, result.title, result.dueAt, new Date(new Date(result.dueAt).getTime() - 15 * 60_000).toISOString()],
          );
        }
        break;
      }
      case "finance": {
        if (result.amountCents != null) {
          await pool.query(`delete from transactions where entry_id = $1 and user_id = $2`, [id, user.id]);
          await pool.query(
            `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              user.id, id,
              result.direction === "in" ? "in" : "out", // 旧 pending 数据无 direction 时默认支出
              Math.abs(result.amountCents),
              result.category ?? "其他",
              result.counterparty ?? null,
              entry.raw_text,
              result.occurredAt ?? new Date().toISOString(),
            ],
          );
        }
        break;
      }
      case "diet": {
        if (result.items?.length) {
          await pool.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [id, user.id]);
          await pool.query(
            `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
             values ($1,$2,$3,$4,$5)`,
            [user.id, id, result.meal ?? "未知", JSON.stringify(result.items), result.totalKcal ?? null],
          );
        }
        break;
      }
    }

    await pool.query(`update entry_recognitions set status = 'applied', updated_at = now() where id = $1`, [rec.id]);
    await client.query("commit");
    return NextResponse.json({ ok: true, domain });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
