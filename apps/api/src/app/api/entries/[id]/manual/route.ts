import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { inferInteractionType } from "@shiguangri/shared/social";

export const runtime = "nodejs";

type ManualDomain = "schedule" | "todo" | "finance" | "mood" | "diet" | "people";
const VALID: ManualDomain[] = ["schedule", "todo", "finance", "mood", "diet", "people"];

/**
 * POST /api/entries/:id/manual { domain, payload } —— 手动补充识别产物（不经 AI）
 * 六域各自落库并写登记簿（engine='manual'），来源动态在动态流中完整呈现。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    domain?: ManualDomain;
    payload?: Record<string, unknown>;
  };
  const domain = body.domain;
  const p = (body.payload ?? {}) as Record<string, any>;
  if (!domain || !VALID.includes(domain)) {
    return NextResponse.json({ error: "domain 需为 schedule/todo/finance/mood/diet/people" }, { status: 400 });
  }

  const entry = (
    await pool.query(`select id, raw_text, created_at from entries where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!entry) return NextResponse.json({ error: "动态不存在" }, { status: 404 });

  const client = await pool.connect();
  try {
    await client.query("begin");
    let message = "";
    let result: unknown = {};

    switch (domain) {
      case "schedule": {
        const title = String(p.title ?? "").trim();
        if (!title || !p.startTime || !p.endTime) {
          await client.query("rollback");
          return NextResponse.json({ error: "需要标题与起止时间" }, { status: 400 });
        }
        // 以动态创建日为基准日，拼接 HH:MM
        const base = new Date(entry.created_at);
        const day = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
        const start = new Date(`${day}T${p.startTime}:00`).toISOString();
        const end = new Date(`${day}T${p.endTime}:00`).toISOString();
        if (end <= start) {
          await client.query("rollback");
          return NextResponse.json({ error: "结束时间必须晚于开始时间" }, { status: 400 });
        }
        const conflict = await findOverlap(user.id, start, end);
        if (conflict) {
          await client.query("rollback");
          return NextResponse.json({ error: overlapError(conflict) }, { status: 409 });
        }
        const activityId = typeof p.activityId === "string" && p.activityId ? p.activityId : "other";
        await client.query(
          `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
           values ($1,$2,$3,$4,$5,$6,'explicit','manual')`,
          [user.id, id, activityId, title, start, end],
        );
        result = { title, start, end };
        message = `🕒 已手动添加日程「${title}」`;
        break;
      }
      case "todo": {
        const title = String(p.title ?? "").trim();
        if (!title) {
          await client.query("rollback");
          return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
        }
        const dueAt = p.dueAt ? new Date(String(p.dueAt)).toISOString() : null;
        const activityId = typeof p.activityId === "string" && p.activityId ? p.activityId : "other";
        await client.query(
          `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source, space_id)
           values ($1,$2,$3,$4,$5,$6,'manual',(select space_id from entries where id = $2))`,
          [user.id, id, title, activityId, dueAt, dueAt ? new Date(new Date(dueAt).getTime() - 15 * 60_000) : null],
        );
        result = { title, dueAt };
        message = `📋 已手动添加待办「${title}」`;
        break;
      }
      case "finance": {
        const yuan = Number(p.yuan);
        if (!Number.isFinite(yuan) || yuan <= 0) {
          await client.query("rollback");
          return NextResponse.json({ error: "金额需大于 0" }, { status: 400 });
        }
        const direction = p.direction === "in" ? "in" : "out";
        await client.query(
          `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at, is_draft)
           values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
          [
            user.id, id, direction, Math.round(yuan * 100),
            typeof p.category === "string" && p.category ? p.category : "其他",
            typeof p.counterparty === "string" && p.counterparty ? p.counterparty : null,
            entry.raw_text, new Date().toISOString(),
          ],
        );
        result = { direction, yuan };
        message = `💰 已手动添加${direction === "out" ? "支出" : "收入"} ¥${yuan}（待确认）`;
        break;
      }
      case "mood": {
        const label = typeof p.label === "string" ? p.label.trim() : "";
        if (!label) {
          await client.query("rollback");
          return NextResponse.json({ error: "请选择心情" }, { status: 400 });
        }
        await client.query(`update entries set mood = $2, mood_score = $3 where id = $1`, [id, label, Number(p.score ?? 0)]);
        result = { label };
        message = `😊 已设置心情「${label}」`;
        break;
      }
      case "diet": {
        const text = typeof p.text === "string" ? p.text.trim() : "";
        if (!text) {
          await client.query("rollback");
          return NextResponse.json({ error: "请填写吃了什么" }, { status: 400 });
        }
        const meal = ["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"].includes(String(p.meal)) ? String(p.meal) : "未知";
        const kcal = Number.isFinite(Number(p.kcal)) && Number(p.kcal) > 0 ? Number(p.kcal) : null;
        await client.query(
          `insert into diet_records (user_id, entry_id, meal, items, total_kcal) values ($1,$2,$3,$4,$5)`,
          [user.id, id, meal, JSON.stringify([{ name: text.slice(0, 40), amount: null, kcal }]), kcal],
        );
        result = { meal, text, kcal };
        message = `🍽 已手动添加饮食「${text}」`;
        break;
      }
      case "people": {
        const name = typeof p.name === "string" ? p.name.trim() : "";
        if (!name) {
          await client.query("rollback");
          return NextResponse.json({ error: "请填写姓名" }, { status: 400 });
        }
        const type = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"].includes(String(p.type)) ? String(p.type) : "见面";
        const c = (
          await client.query(
            `insert into contacts (user_id, name) values ($1, $2)
             on conflict (user_id, name) do update set name = excluded.name returning id`,
            [user.id, name],
          )
        ).rows[0];
        await client.query(
          `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [user.id, c.id, id, type, entry.raw_text.slice(0, 60), new Date().toISOString()],
        );
        result = { name, type };
        message = `👥 已记录与「${name}」的往来`;
        break;
      }
    }

    // 登记簿：手动添加标记为 applied + manual
    await client.query(
      `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
       values ($1,$2,$3,'applied',$4,1,'manual')
       on conflict (entry_id, domain) do update set
         status = 'applied', result = excluded.result, confidence = 1,
         engine = 'manual', updated_at = now()`,
      [user.id, id, domain, JSON.stringify(result ?? {})],
    );

    await client.query("commit");
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    await client.query("rollback");
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
