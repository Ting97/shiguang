import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import { blockLines, chatReviewJson, entryLines, loadProfileBlock, todoDoneLines, withCap } from "@/lib/review-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "Asia/Shanghai";

interface DayReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/day {date} —— AI 日小结（Phase 4 复盘引擎 MVP）
 * 聚合当天时间/待办/收支/人际/心情事实 → LLM 归因解读；只依据真实记录，不落库（每次即时生成）。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const q = await checkAiQuota(user.id);
  if (!q.allowed) {
    return NextResponse.json(
      { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`, quota: q },
      { status: 402 },
    );
  }
  const { date, refresh } = (await req.json().catch(() => ({}))) as { date?: string; refresh?: boolean };
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  // ---- 当天事实聚合（全部按北京日切）----
  const [timeRows, todoRows, txRows, interactRows, entryRows, kcalRows, rawEntryRows, blockRows, todoListRows] = await Promise.all([
    pool.query(
      `select a.name, a.icon,
              sum(floor(extract(epoch from least((b.end_at at time zone $2), ($3::date + 1))
                       - greatest((b.start_at at time zone $2), $3::date)) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($3::date + 1)
       group by 1, 2 order by mins desc`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select count(*)::int as n from todos
       where user_id = $1 and status = 'done'
         and (done_at at time zone $2)::date = $3::date`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents,
              coalesce(sum(case when direction='in' then amount_cents else 0 end),0)::int as in_cents
       from transactions
       where user_id = $1 and is_draft = false and (occurred_at at time zone $2)::date = $3::date`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select c.name, count(*)::int as n from interactions i join contacts c on c.id = i.contact_id
       where i.user_id = $1 and (i.occurred_at at time zone $2)::date = $3::date
       group by 1 order by n desc limit 5`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select count(*)::int as n, coalesce(array_agg(mood) filter (where mood is not null), '{}') as moods
       from entries where user_id = $1 and (created_at at time zone $2)::date = $3::date`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select coalesce(sum(d.total_kcal), 0)::int as kcal
       from diet_records d join entries e on e.id = d.entry_id
       where d.user_id = $1 and (e.created_at at time zone $2)::date = $3::date`,
      [user.id, TZ, date],
    ),
    // ---- 原始明细（v3：动态原文+发布时间+心情 / 日程块 / 完成待办）----
    pool.query(
      `select raw_text, mood, mood_score, created_at from entries
       where user_id = $1 and (created_at at time zone $2)::date = $3::date
       order by created_at`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select b.title, b.start_at, b.end_at, a.icon, a.name
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($3::date + 1)
       order by b.start_at`,
      [user.id, TZ, date],
    ),
    pool.query(
      `select title, done_at from todos
       where user_id = $1 and status = 'done' and (done_at at time zone $2)::date = $3::date
       order by done_at`,
      [user.id, TZ, date],
    ),
  ]);

  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ""}` : `${m}分`);
  const timeParts = timeRows.rows.map((r) => `${r.icon}${r.name} ${fmtMin(r.mins)}`);
  const facts = [
    `日期：${date}`,
    `时间块：${timeParts.length ? timeParts.join("、") : "无"}`,
    `完成待办：${todoRows.rows[0].n} 件`,
    `支出 ¥${(txRows.rows[0].out_cents / 100).toFixed(0)} · 收入 ¥${(txRows.rows[0].in_cents / 100).toFixed(0)}`,
    interactRows.rows.length
      ? `人际互动：${interactRows.rows.map((r) => `${r.name}${r.n}次`).join("、")}`
      : "人际互动：无",
    `动态 ${entryRows.rows[0].n} 条${entryRows.rows[0].moods.length ? `（心情：${entryRows.rows[0].moods.join("、")}）` : ""}`,
    kcalRows.rows[0].kcal > 0 ? `饮食约 ${kcalRows.rows[0].kcal} kcal` : "",
  ].filter(Boolean);

  const system = `你是个人经营助手「拾光复利」，为用户做**每日复盘**。输入是该用户当天的全部真实记录：原始动态（含发布时间与心情标注）、日程块、完成待办、聚合统计。请依次判断：
1. 当天的心情状况如何（结合心情标注与原文语气）；
2. 主要时间花销去了哪里；
3. 总结这一天，说出做得好的地方，给出明天可改进的建议。
只依据事实归纳，**严禁编造**；语气温和务实，不灌鸡汤。全文 100 字左右。严格输出 JSON：
{
  "summary": "当日总结，≤60字，突出心情与时间去向",
  "highlights": ["做得好的地方，最多2条，每条≤20字"],
  "suggestions": ["明天可改进的建议，最多2条，每条≤20字"]
}`;

  // ---- 画像注入（越用越懂用户）：有画像才拼入，无则跳过 ----
  const profileBlock = await loadProfileBlock(user.id);

  const latest = (
    await pool.query(
      `select greatest(
         (select max(created_at) from entries where user_id = $1 and (created_at at time zone $2)::date = $3::date),
         (select max(done_at) from todos where user_id = $1 and status = 'done' and (done_at at time zone $2)::date = $3::date),
         (select max(occurred_at) from transactions where user_id = $1 and (occurred_at at time zone $2)::date = $3::date),
         (select max(start_at) from time_blocks where user_id = $1 and (start_at at time zone $2)::date = $3::date and start_at <= now()),
         (select max(occurred_at) from interactions where user_id = $1 and (occurred_at at time zone $2)::date = $3::date)
       ) as latest`,
      [user.id, TZ, date],
    )
  ).rows[0].latest;

  // ---- 原始明细文本块（在聚合 facts 之外给模型全部一手记录）----
  const detailText = [
    ["原始动态（时间 原文 心情）：", ...withCap(entryLines(rawEntryRows.rows), 500, "条动态")].join("\n"),
    ["日程块：", blockLines(blockRows.rows).join("\n") || "无"].join("\n"),
    ["完成待办：", todoDoneLines(todoListRows.rows).join("\n") || "无"].join("\n"),
  ].join("\n\n");
  const userPrompt = [facts.join("\n"), detailText, profileBlock ? `该用户的已知画像（供理解参考，不要复述）：\n${profileBlock}` : null]
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    result = await getOrGenerateReview(user.id, "day", date, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      const parsed = await chatReviewJson<Partial<DayReview>>({
        system,
        user: userPrompt,
        maxTokens: 700,
        timeoutMs: 45_000,
        onUsage: capture,
      });
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 30)).filter(Boolean).slice(0, n) : []);
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 80)
          : "这一天记录还很少，多记几句再来复盘会更有料",
      highlights: arr(parsed.highlights, 2),
      suggestions: arr(parsed.suggestions, 2),
    };
    });
  } catch {
    // 解析失败（重问后仍非法 JSON）不缓存，向前端返回可读错误
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, facts: { timeParts, todoDone: todoRows.rows[0].n } });
}
