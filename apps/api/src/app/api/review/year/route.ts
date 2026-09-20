import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chat, extractJson, hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;
const TZ = "Asia/Shanghai";

interface YearReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/year {year} —— AI 年报（Phase 4 复盘引擎）
 * year 为 YYYY；聚合全年时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { year, refresh } = (await req.json().catch(() => ({}))) as { year?: string; refresh?: boolean };
  if (!year || !YEAR_RE.test(year)) {
    return NextResponse.json({ error: "year 需为 YYYY" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [timeRows, todoRows, txRows, interactRows, entryRows, mmTimeRows, mmEntryRows, mmTxRows] = await Promise.all([
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
    // ---- 逐月轨迹（跨月块按起止月分别计入时长；活动取每月 top3）----
    pool.query(
      `select extract(month from (b.start_at at time zone $2))::int as mm, a.name, a.icon,
              sum(floor(extract(epoch from
                least(least((b.end_at at time zone $2), ($4::date + 1)), date_trunc('month', (b.start_at at time zone $2)) + interval '1 month')
                - greatest(greatest((b.start_at at time zone $2), $3::date), date_trunc('month', (b.start_at at time zone $2)))
              ) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       group by 1, 2, 3`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select extract(month from (created_at at time zone $2))::int as mm, count(*)::int as n
       from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select extract(month from (occurred_at at time zone $2))::int as mm,
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
  // 逐月轨迹行：1…12 月，各取 top3 活动 + 动态数 + 支出
  const mmAgg = new Map<number, { acts: string[]; n: number; out: number }>(
    Array.from({ length: 12 }, (_, i) => [i + 1, { acts: [], n: 0, out: 0 }]),
  );
  for (const r of mmTimeRows.rows) {
    const d = mmAgg.get(r.mm);
    if (d && d.acts.length < 3) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
  }
  for (const r of mmEntryRows.rows) {
    const d = mmAgg.get(r.mm);
    if (d) d.n = r.n;
  }
  for (const r of mmTxRows.rows) {
    const d = mmAgg.get(r.mm);
    if (d) d.out = r.out_cents;
  }
  const monthLines = [...mmAgg.entries()].map(([mm, d]) => {
    const bits = [d.acts.join("、"), d.n ? `动态${d.n}条` : "", d.out ? `支出¥${(d.out / 100).toFixed(0)}` : ""].filter(Boolean);
    return `${mm}月：${bits.length ? bits.join(" · ") : "无记录"}`;
  });
  const facts = [
    `周期：${year} 年（${from} 至 ${to}）`,
    `时间投入：${timeParts.length ? timeParts.join("、") : "无"}`,
    `完成待办：${todoRows.rows[0].n} 件`,
    `支出 ¥${(txRows.rows[0].out_cents / 100).toFixed(0)} · 收入 ¥${(txRows.rows[0].in_cents / 100).toFixed(0)}`,
    interactRows.rows.length ? `人际互动：${interactRows.rows.map((r) => `${r.name}${r.n}次`).join("、")}` : "人际互动：无",
    `动态 ${entryRows.rows[0].n} 条（覆盖 ${entryRows.rows[0].days} 天）${entryRows.rows[0].moods.length ? `（心情：${entryRows.rows[0].moods.join("、")}）` : ""}`,
    "逐月轨迹：",
    ...monthLines,
  ];

  const system = `你是个人经营助手「拾光复利」，基于用户一年的**真实记录**（含逐月轨迹）写一份年报。只依据事实归纳，**严禁编造**；语气温和务实，不灌鸡汤。请梳理全年节奏与成长轨迹。严格输出 JSON：
{
  "summary": "这一年的总结（≤150字，突出全年时间结构、坚持情况和成长轨迹）",
  "highlights": ["值得肯定的亮点，最多5条"],
  "suggestions": ["明年可改进的具体建议，最多3条，没有依据就空数组"]
}`;


  const latest = (
    await pool.query(
      `select greatest(
         (select max(created_at) from entries where user_id = $1 and extract(year from created_at) = $2::int),
         (select max(done_at) from todos where user_id = $1 and status = 'done' and extract(year from done_at) = $2::int),
         (select max(occurred_at) from transactions where user_id = $1 and extract(year from occurred_at) = $2::int),
         (select max(start_at) from time_blocks where user_id = $1 and extract(year from start_at) = $2::int and start_at <= now()),
         (select max(occurred_at) from interactions where user_id = $1 and extract(year from occurred_at) = $2::int)
       ) as latest`,
      [user.id, Number(year)],
    )
  ).rows[0].latest;

  const { review, cached, generatedAt } = await getOrGenerateReview(user.id, "year", year, refresh === true, latest ? new Date(latest) : null, async (capture) => {
    const raw = await chat({
      system,
      user: facts.join("\n"),
      temperature: 0.4,
      maxTokens: 1400,
      timeoutMs: 45_000,
      onUsage: capture,
    });
    const parsed = extractJson(raw) as Partial<YearReview>;
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, n) : []);
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 200)
          : "这一年记录还很少，多记几天再来复盘会更有料",
      highlights: arr(parsed.highlights, 5),
      suggestions: arr(parsed.suggestions, 3),
    };
  });

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
}
