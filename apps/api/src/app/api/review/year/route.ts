import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import { acquireGeneration, consumeGeneration, ReviewGateError } from "@/lib/review-quota";
import { getPrompt } from "@/lib/prompts";
import {
  BLOCK_CAPS, ENTRY_CAPS, TODO_CAPS,
  blockLines, chatReviewJson, entryLines, fetchChainSummaries, loadProfileBlock, sampleEntryRows, todoDoneLines, withCap,
} from "@/lib/review-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;
const TZ = "Asia/Shanghai";

interface YearReview {
  summary: string;
  sections?: { title: string; text: string }[];
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
  if (user.role !== "admin") {
    const q = await checkAiQuota(user.id);
    if (!q.allowed) {
      return NextResponse.json(
        { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`, quota: q },
        { status: 402 },
      );
    }
  }
  const { year, refresh } = (await req.json().catch(() => ({}))) as { year?: string; refresh?: boolean };
  if (!year || !YEAR_RE.test(year)) {
    return NextResponse.json({ error: "year 需为 YYYY" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [timeRows, todoRows, txRows, interactRows, entryRows, mmTimeRows, mmEntryRows, mmTxRows, rawEntryRows, blockRows, todoListRows] = await Promise.all([
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
    // ---- 原始明细（v3：全年动态取心情强度优先抽样 / 日程块 / 完成待办）----
    pool.query(
      `select raw_text, mood, mood_score, created_at from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
       order by created_at`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select b.title, b.start_at, b.end_at, a.icon, a.name
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       order by b.start_at`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select title, done_at from todos
       where user_id = $1 and status = 'done' and (done_at at time zone $2)::date between $3::date and $4::date
       order by done_at`,
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

  const system = await getPrompt("review_year");

  // ---- 小结链（已有月报才带）+ 画像注入 ----
  const chainLines = await fetchChainSummaries(
    user.id,
    "year",
    Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${String(i + 1).padStart(2, "0")}`, label: `${i + 1}月` })),
  );
  const profileBlock = await loadProfileBlock(user.id);


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

  // ---- 原始明细文本块（全年动态抽样：心情强度优先、按月均匀）----
  const sampled = sampleEntryRows(rawEntryRows.rows, ENTRY_CAPS.year);
  const totalEntries = rawEntryRows.rows.length;
  const entryBlock = [
    ...entryLines(sampled),
    ...(totalEntries > sampled.length ? [`（全年共 ${totalEntries} 条动态，以上为代表性抽样 ${sampled.length} 条）`] : []),
  ].join("\n");
  const detailText = [
    ["代表性原始动态（时间 原文 心情）：", entryBlock].join("\n"),
    ["日程块：", ...withCap(blockLines(blockRows.rows), BLOCK_CAPS.year, "个日程")].join("\n") || "日程块：无",
    ["完成待办：", ...withCap(todoDoneLines(todoListRows.rows), TODO_CAPS.year, "条待办")].join("\n") || "完成待办：无",
  ].join("\n\n");
  const userPrompt = [
    facts.join("\n"),
    chainLines.length ? "全年各月月报小结：\n" + chainLines.join("\n") : null,
    detailText,
    profileBlock ? `该用户的已知画像（供理解参考，不要复述）：\n${profileBlock}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    result = await getOrGenerateReview(user.id, "year", year, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "year", year, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<YearReview>>({
        system,
        user: userPrompt,
        maxTokens: 4000,
        timeoutMs: 90_000,
        onUsage: capture,
      });
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 48)).filter(Boolean).slice(0, n) : []);
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .filter((s) => s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string")
          .slice(0, 5)
          .map((s) => ({ title: String(s.title).slice(0, 12), text: String(s.text).slice(0, 300) }))
      : [];
      await consumeGeneration(user.id, "year", year);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 220)
            : "这一年记录还很少，多记几天再来复盘会更有料",
        sections,
        highlights: arr(parsed.highlights, 5),
        suggestions: arr(parsed.suggestions, 3),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
}
