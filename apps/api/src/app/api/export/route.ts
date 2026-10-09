import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export?format=json|md —— 导出我的全部数据（docs/06 P8：数据可携带）
 * json=全量备份（所有表）；md=可读的动态日记。生产环境建议定期下载 json 备份。
 */
export const GET = withAuth(async (req, { user }) => {
  const format = new URL(req.url).searchParams.get("format") ?? "json";

  // 串行取数（同一连接逐条复用）：单请求并发 9 条全量查询会占满连接池（max 10），
  // 3 人并发导出即让全站请求排队。单用户串行慢一点无感（导出本就低频），全站吞吐优先。
  const serial = async (queries: { sql: string; vals: unknown[] }[]) => {
    const out: { rows: any[] }[] = [];
    for (const q of queries) out.push(await pool.query(q.sql, q.vals));
    return out;
  };
  const [entries, blocks, todos, transactions, diets, contacts, interactions, accounts, budgets] = await serial([
    // 不再 at time zone 预转北京墙上时间：pg 会按宿主本地时区解析该 timestamp，再被上方 bj 的 +8h 二次偏移；
    // 统一取绝对时刻（timestamptz），展示层统一 +8h 换算（与其他表列口径一致）
    { sql: `select id, raw_text, source, mood, mood_score, created_at
       from entries where user_id = $1 order by created_at`, vals: [user.id] },
    { sql: `select b.title, b.activity_id, a.name as activity, b.start_at, b.end_at, b.duration_min, b.time_mode, b.source
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1 order by b.start_at`, vals: [user.id] },
    { sql: `select title, status, due_at, done_at, created_at from todos where user_id = $1 order by created_at`, vals: [user.id] },
    { sql: `select direction, amount_cents, category, counterparty, note, occurred_at, is_draft, account_id
       from transactions where user_id = $1 order by occurred_at`, vals: [user.id] },
    { sql: `select d.meal, d.items, d.total_kcal, e.created_at as recorded_at
       from diet_records d join entries e on e.id = d.entry_id
       where d.user_id = $1 order by e.created_at`, vals: [user.id] },
    { sql: `select name, alias, group_tag, birthday, birthday_cal, lunar_month, lunar_day, lunar_leap, anniversary, importance, intimacy, notes
       from contacts where user_id = $1 order by created_at`, vals: [user.id] },
    { sql: `select c.name as contact, i.type, i.summary, i.occurred_at
       from interactions i join contacts c on c.id = i.contact_id
       where i.user_id = $1 order by i.occurred_at`, vals: [user.id] },
    { sql: `select name, icon, opening_balance_cents, archived from accounts where user_id = $1`, vals: [user.id] },
    { sql: `select monthly_limit_cents, alert_threshold from budgets where user_id = $1`, vals: [user.id] },
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const download = (body: string, ext: string, type: string) =>
    new NextResponse(body, {
      headers: {
        "Content-Type": `${type}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="shiguangri-export-${stamp}.${ext}"`,
      },
    });

  // 北京时间口径：+8h 后读 UTC getter（getFullYear/getHours 等本地 getter 随宿主时区漂移，UTC 容器上会差 8 小时）
  const bj = (v: unknown) => new Date(new Date(String(v)).getTime() + 8 * 3600_000);
  const localYmd = (v: unknown) => { const d = bj(v); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
  const localClock = (v: unknown) => { const d = bj(v); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

  if (format === "md") {
    const lines: string[] = [
      `# 拾光 · 动态日记`,
      ``,
      // 北京口径导出时间（UTC 容器上 toLocaleString 会显示 UTC 时刻，与全站口径不一致）
      `> 导出时间：${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ")}（北京时间） · 共 ${entries.rows.length} 条动态`,
      ``,
    ];
    // 日程块按天预分组一次（跨天块按交集归属，与日视图口径一致）：
    // 此前在动态循环内逐条 filter，同一天有多条动态时当天块重复输出 E 遍且 O(E×B) 反复解析日期
    const blocksByDay = new Map<string, any[]>();
    const DAY_MS = 24 * 3600_000;
    // bj 后的 UTC 日期即北京墙上日期，对齐到当日 0 点（日界地板）后逐天枚举覆盖块交集的每一天
    const dayFloor = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
    for (const b of blocks.rows) {
      if (!b.start_at) continue;
      const startMs = bj(b.start_at).getTime();
      const endMs = b.end_at ? Math.max(bj(b.end_at).getTime(), startMs) : startMs;
      // 最多枚举 60 天（防病态超长跨天块），正常块只落 1~2 天
      for (let t = dayFloor(startMs), i = 0; t <= dayFloor(endMs) && i < 60; t += DAY_MS, i++) {
        const d = new Date(t);
        const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        let list = blocksByDay.get(day);
        if (!list) blocksByDay.set(day, (list = []));
        list.push(b);
      }
    }
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
      for (const b of blocksByDay.get(day) ?? []) {
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
    exported_at: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ") + "+08:00",
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
});
