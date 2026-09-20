import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chat, extractJson, hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "Asia/Shanghai";

interface WeekReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/week {date} —— AI 周报（Phase 4 复盘引擎）
 * date 为该周任一天；聚合本周时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { date, refresh } = (await req.json().catch(() => ({}))) as { date?: string; refresh?: boolean };
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  // 周一为一周开始
  const d = new Date(date + "T00:00:00");
  const daysIntoWeek = (d.getDay() + 6) % 7;
  const monday = new Date(d.getTime() - daysIntoWeek * 86_400_000);
  const localYmd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const from = localYmd(monday);
  const to = localYmd(new Date(monday.getTime() + 6 * 86_400_000));

  const [timeRows, todoRows, txRows, interactRows, entryRows, dayTimeRows, dayEntryRows, dayTxRows] = await Promise.all([
    pool.query(
      `select a.name, a.icon,
              sum(floor(extract(epoch from least((b.end_at at time zone $2), ($4::date + 1))
                       - greatest((b.start_at at time zone $2), $3::date)) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       group by 1, 2 order by mins desc limit 5`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select count(*)::int as n from todos
       where user_id = $1 and status = 'done'
         and (done_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents,
              coalesce(sum(case when direction='in' then amount_cents else 0 end),0)::int as in_cents
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select c.name, count(*)::int as n from interactions i join contacts c on c.id = i.contact_id
       where i.user_id = $1 and (i.occurred_at at time zone $2)::date between $3::date and $4::date
       group by 1 order by n desc limit 3`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select count(*)::int as n,
              count(distinct (created_at at time zone $2)::date)::int as days,
              coalesce(array_agg(distinct mood) filter (where mood is not null), '{}') as moods
       from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, from, to],
    ),
    // ---- 每日明细（喂给模型逐日对比；活动取每日 top2）----
    pool.query(
      `select (b.start_at at time zone $2)::date::text as day, a.name, a.icon,
              sum(floor(extract(epoch from least((b.end_at at time zone $2), ($4::date + 1))
                       - greatest((b.start_at at time zone $2), $3::date)) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       group by 1, 2, 3`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select (created_at at time zone $2)::date::text as day, count(*)::int as n
       from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select (occurred_at at time zone $2)::date::text as day,
              coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      [user.id, TZ, from, to],
    ),
  ]);

  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ""}` : `${m}分`);
  const timeParts = timeRows.rows.map((r) => `${r.icon}${r.name} ${fmtMin(r.mins)}`);
  // 每日明细行：周一…周日，各取 top2 活动 + 动态数 + 支出
  const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayAgg = new Map<string, { acts: string[]; n: number; out: number }>(
    Array.from({ length: 7 }, (_, i) => {
      const k = localYmd(new Date(monday.getTime() + i * 86_400_000));
      return [k, { acts: [], n: 0, out: 0 }];
    }),
  );
  for (const r of dayTimeRows.rows) {
    const d = dayAgg.get(r.day);
    if (d && d.acts.length < 2) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
  }
  for (const r of dayEntryRows.rows) {
    const d = dayAgg.get(r.day);
    if (d) d.n = r.n;
  }
  for (const r of dayTxRows.rows) {
    const d = dayAgg.get(r.day);
    if (d) d.out = r.out_cents;
  }
  const dayLines = [...dayAgg.entries()].map(([k, d], i) => {
    const bits = [d.acts.join("、"), d.n ? `动态${d.n}条` : "", d.out ? `支出¥${(d.out / 100).toFixed(0)}` : ""].filter(Boolean);
    return `${WD[i]}(${k.slice(5)})：${bits.length ? bits.join(" · ") : "无记录"}`;
  });
  const facts = [
    `周期：${from} 至 ${to}`,
    `时间投入：${timeParts.length ? timeParts.join("、") : "无"}`,
    `完成待办：${todoRows.rows[0].n} 件`,
    `支出 ¥${(txRows.rows[0].out_cents / 100).toFixed(0)} · 收入 ¥${(txRows.rows[0].in_cents / 100).toFixed(0)}`,
    interactRows.rows.length ? `人际互动：${interactRows.rows.map((r) => `${r.name}${r.n}次`).join("、")}` : "人际互动：无",
    `动态 ${entryRows.rows[0].n} 条（覆盖 ${entryRows.rows[0].days} 天）${entryRows.rows[0].moods.length ? `（心情：${entryRows.rows[0].moods.join("、")}）` : ""}`,
    "每日明细：",
    ...dayLines,
  ];

  const system = `你是个人经营助手「拾光复利」，基于用户一周的**真实记录**（含每日明细）写一份周报。只依据事实归纳对比，**严禁编造**；语气温和务实，不灌鸡汤。可引用具体某天的表现做对比。严格输出 JSON：
{
  "summary": "这一周的总结（≤80字，突出时间结构、节奏变化和整体状态）",
  "highlights": ["值得肯定的亮点，最多3条，可引用具体某天"],
  "suggestions": ["下周可改进的具体建议，最多2条，没有依据就空数组"]
}`;


  const latest = (
    await pool.query(
      `select greatest(
         (select max(created_at) from entries where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date),
         (select max(done_at) from todos where user_id = $1 and status = 'done' and (done_at at time zone $2)::date between $3::date and $4::date),
         (select max(occurred_at) from transactions where user_id = $1 and (occurred_at at time zone $2)::date between $3::date and $4::date),
         (select max(start_at) from time_blocks where user_id = $1 and (start_at at time zone $2)::date between $3::date and $4::date and start_at <= now()),
         (select max(occurred_at) from interactions where user_id = $1 and (occurred_at at time zone $2)::date between $3::date and $4::date)
       ) as latest`,
      [user.id, TZ, from, to],
    )
  ).rows[0].latest;

  const { review, cached, generatedAt } = await getOrGenerateReview(user.id, "week", from, refresh === true, latest ? new Date(latest) : null, async (capture) => {
    const raw = await chat({
      system,
      user: facts.join("\n"),
      temperature: 0.4,
      maxTokens: 800,
      timeoutMs: 45_000,
      onUsage: capture,
    });
    const parsed = extractJson(raw) as Partial<WeekReview>;
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, n) : []);
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 110)
          : "这一周记录还很少，多记几天再来复盘会更有料",
      highlights: arr(parsed.highlights, 3),
      suggestions: arr(parsed.suggestions, 2),
    };
  });

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
}
