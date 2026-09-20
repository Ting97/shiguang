import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";

/**
 * GET /api/export?format=json|md —— 导出我的全部数据（docs/06 P8：数据可携带）
 * json=全量备份（所有表）；md=可读的动态日记。生产环境建议定期下载 json 备份。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const format = new URL(req.url).searchParams.get("format") ?? "json";

  const [entries, blocks, todos, transactions, diets, contacts, interactions, accounts, budgets] = await Promise.all([
    pool.query(
      `select id, raw_text, source, mood, mood_score, (created_at at time zone $2) as created_at
       from entries where user_id = $1 order by created_at`,
      [user.id, TZ],
    ),
    pool.query(
      `select b.title, b.activity_id, a.name as activity, b.start_at, b.end_at, b.duration_min, b.time_mode, b.source
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1 order by b.start_at`,
      [user.id],
    ),
    pool.query(`select title, status, due_at, done_at, created_at from todos where user_id = $1 order by created_at`, [user.id]),
    pool.query(
      `select direction, amount_cents, category, counterparty, note, occurred_at, is_draft, account_id
       from transactions where user_id = $1 order by occurred_at`,
      [user.id],
    ),
    pool.query(
      `select d.meal, d.items, d.total_kcal, (e.created_at at time zone $2) as recorded_at
       from diet_records d join entries e on e.id = d.entry_id
       where d.user_id = $1 order by e.created_at`,
      [user.id, TZ],
    ),
    pool.query(
      `select name, alias, group_tag, birthday, birthday_cal, lunar_month, lunar_day, lunar_leap, anniversary, importance, intimacy, notes
       from contacts where user_id = $1 order by created_at`,
      [user.id],
    ),
    pool.query(
      `select c.name as contact, i.type, i.summary, i.occurred_at
       from interactions i join contacts c on c.id = i.contact_id
       where i.user_id = $1 order by i.occurred_at`,
      [user.id],
    ),
    pool.query(`select name, icon, opening_balance_cents, archived from accounts where user_id = $1`, [user.id]),
    pool.query(`select monthly_limit_cents, alert_threshold from budgets where user_id = $1`, [user.id]),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const download = (body: string, ext: string, type: string) =>
    new NextResponse(body, {
      headers: {
        "Content-Type": `${type}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="shiguangri-export-${stamp}.${ext}"`,
      },
    });

  const localYmd = (v: unknown) => { const d = new Date(String(v)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const localClock = (v: unknown) => { const d = new Date(String(v)); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  if (format === "md") {
    const lines: string[] = [
      `# 拾光 · 动态日记`,
      ``,
      `> 导出时间：${new Date().toLocaleString("zh-CN")} · 共 ${entries.rows.length} 条动态`,
      ``,
    ];
    let lastDay = "";
    for (const e of entries.rows) {
      const day = localYmd(e.created_at);
      if (day !== lastDay) {
        lines.push(`\n## ${day}\n`);
        lastDay = day;
      }
      const clock = localClock(e.created_at);
      const mood = e.mood ? `（心情：${e.mood}）` : "";
      lines.push(`- **${clock}** ${e.raw_text}${mood}`);
      // 当天日程块（跨天块按交集归属，与日视图口径一致）
      for (const b of blocks.rows.filter((b: any) => b.start_at && (localYmd(b.start_at) === day || localYmd(b.end_at) === day))) {
        const startTime = localClock(b.start_at);
        const endTime = localClock(b.end_at);
        lines.push(`  - 🕒 ${b.activity ?? ""} ${b.title}（${startTime}–${endTime}，${b.duration_min} 分钟）`);
      }
    }
    lines.push(`\n---\n\n## 日程（全部时间块）\n`);
    for (const b of blocks.rows) {
      lines.push(
        `- ${localYmd(b.start_at)} ${localClock(b.start_at)}–${localClock(b.end_at)} ${b.activity ?? ""} ${b.title}（${b.duration_min} 分钟）`,
      );
    }
    lines.push(`\n## 分类账\n`);
    for (const t of todos.rows) {
      lines.push(`- [${t.status === "done" ? "x" : " "}] ${t.title}${t.due_at ? `（截止 ${localYmd(t.due_at)}）` : ""}`);
    }
    lines.push(`\n## 财务（非草稿）\n`);
    for (const t of transactions.rows.filter((t: any) => !t.is_draft)) {
      lines.push(
        `- ${localYmd(t.occurred_at)} ${t.direction === "out" ? "支出" : "收入"} ¥${(t.amount_cents / 100).toFixed(2)} · ${t.category}${t.counterparty ? ` · ${t.counterparty}` : ""}${t.note ? ` · ${t.note}` : ""}`,
      );
    }
    lines.push(`\n## 人际往来\n`);
    for (const i of interactions.rows) {
      lines.push(`- ${i.occurred_at ? localYmd(i.occurred_at) : ""} [${i.type}] ${i.contact}：${i.summary ?? ""}`);
    }
    return download(lines.join("\n"), "md", "text/markdown");
  }

  // 默认 json 全量备份
  const backup = {
    exported_at: new Date().toISOString(),
    profile: { nickname: user.nickname ?? null, phone: user.phone ?? null },
    entries: entries.rows,
    time_blocks: blocks.rows,
    todos: todos.rows,
    transactions: transactions.rows,
    diet_records: diets.rows,
    contacts: contacts.rows,
    interactions: interactions.rows,
    accounts: accounts.rows,
    budgets: budgets.rows,
  };
  return download(JSON.stringify(backup, null, 2), "json", "application/json");
}
