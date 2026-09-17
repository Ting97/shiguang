import { NextResponse } from "next/server";
import { pool, DEV_USER_ID, findOverlap, overlapError } from "@/lib/db";
import { parseInput } from "@shiguangri/ai";

export const runtime = "nodejs";

/** POST /api/parse  { text } —— 一句话发动态：AI 识别意图后落 TODO / 日程块 / 纯心情 (+财务/人际草稿) */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text 必填" }, { status: 400 });
  }

  const r = await parseInput(text.trim());

  const client = await pool.connect();
  try {
    await client.query("begin");
    // 动态本体：记录时刻 created_at + AI 心情
    const entry = (
      await client.query(
        `insert into entries (user_id, source, raw_text, mood, mood_score)
         values ($1,'keyboard',$2,$3,$4) returning id, raw_text, mood, mood_score, created_at`,
        [DEV_USER_ID, text.trim(), r.mood.label, r.mood.score],
      )
    ).rows[0];

    if (r.intent === "todo") {
      const remind = new Date(new Date(r.time.start).getTime() - 15 * 60_000);
      const todo = (
        await client.query(
          `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source)
           values ($1,$2,$3,$4,$5,$6,'keyboard') returning *`,
          [DEV_USER_ID, entry.id, r.title, r.activity, r.time.start, remind.toISOString()],
        )
      ).rows[0];
      await client.query("commit");
      return NextResponse.json({ kind: "todo", result: r, todo, entry });
    }

    // 纯心情/状态动态：不生成日程，到此为止
    if (r.intent === "status") {
      await client.query("commit");
      return NextResponse.json({ kind: "moment", result: r, entry });
    }

    // schedule：时间轴约束（一个时刻只能做一件事）
    const conflict = await findOverlap(DEV_USER_ID, r.time.start, r.time.end);
    if (conflict) {
      await client.query("rollback");
      return NextResponse.json({ error: overlapError(conflict), conflict }, { status: 409 });
    }

    const block = (
      await client.query(
        `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
         values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
        [DEV_USER_ID, entry.id, r.activity, r.title, r.time.start, r.time.end, r.time.mode],
      )
    ).rows[0];
    // 财务草稿
    if (r.finance.hasAmount && r.finance.amountCents != null) {
      await client.query(
        `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          DEV_USER_ID, entry.id,
          r.finance.amountCents < 0 ? "out" : "in",
          Math.abs(r.finance.amountCents),
          r.finance.category ?? "其他",
          r.finance.counterparty ?? null,
          text.trim(),
          r.time.end,
        ],
      );
    }

    // 人际草稿：联系人 upsert + 往来事件
    for (const p of r.people) {
      const c = (
        await client.query(
          `insert into contacts (user_id, name) values ($1,$2)
           on conflict (user_id, name) do update set name = excluded.name returning id`,
          [DEV_USER_ID, p.name],
        )
      ).rows[0];
      await client.query(
        `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [DEV_USER_ID, c.id, entry.id, "其他", `${p.event ?? "互动"}：${r.title}`, r.time.end],
      );
    }

    await client.query("commit");
    return NextResponse.json({ kind: "block", result: r, block, entry });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
