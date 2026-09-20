import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import {
  BLOCK_CAPS, ENTRY_CAPS, TODO_CAPS,
  blockLines, chatReviewJson, entryLines, fetchChainSummaries, loadProfileBlock, todoDoneLines, updateProfileFromReview, withCap,
} from "@/lib/review-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}$/;
const TZ = "Asia/Shanghai";

interface MonthReview {
  summary: string;
  sections?: { title: string; text: string }[];
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/month {month} —— AI 月报（Phase 4 复盘引擎）
 * month 为 YYYY-MM；聚合本月时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
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
  const { month, refresh } = (await req.json().catch(() => ({}))) as { month?: string; refresh?: boolean };
  if (!month || !DATE_RE.test(month)) {
    return NextResponse.json({ error: "month 需为 YYYY-MM" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const localYmd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const to = localYmd(new Date(y, m, 0)); // 当月最后一天（本地日历日，避免 toISOString 退一天）

  const [timeRows, todoRows, txRows, interactRows, entryRows, wkTimeRows, wkEntryRows, wkTxRows, rawEntryRows, blockRows, todoListRows] = await Promise.all([
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
    // ---- 每周对比（自然周，跨月周只计入本月内的时长；活动取每周 top3）----
    pool.query(
      `select to_char(date_trunc('week', (b.start_at at time zone $2)), 'YYYY-MM-DD') as wk, a.name, a.icon,
              sum(floor(extract(epoch from
                least(least((b.end_at at time zone $2), ($4::date + 1)), date_trunc('week', (b.start_at at time zone $2)) + interval '7 days')
                - greatest(greatest((b.start_at at time zone $2), $3::date), date_trunc('week', (b.start_at at time zone $2)))
              ) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       group by 1, 2, 3`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select to_char(date_trunc('week', (created_at at time zone $2)), 'YYYY-MM-DD') as wk, count(*)::int as n
       from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      [user.id, TZ, from, to],
    ),
    pool.query(
      `select to_char(date_trunc('week', (occurred_at at time zone $2)), 'YYYY-MM-DD') as wk,
              coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      [user.id, TZ, from, to],
    ),
    // ---- 原始明细（v3：动态原文+发布时间+心情 / 日程块 / 完成待办）----
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
  // 每周对比行：枚举整月覆盖到的所有自然周（空周显示"无记录"），label 用周一日期，活动取 top3
  const wkAgg = new Map<string, { acts: string[]; n: number; out: number }>();
  const wkKey = (k: string | null | undefined) => (typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
  for (const r of wkTimeRows.rows) {
    const k = wkKey(r.wk);
    if (!k) continue;
    const d = wkAgg.get(k) ?? { acts: [], n: 0, out: 0 };
    if (d.acts.length < 3) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
    wkAgg.set(k, d);
  }
  for (const r of wkEntryRows.rows) {
    const k = wkKey(r.wk);
    if (!k) continue;
    const d = wkAgg.get(k) ?? { acts: [], n: 0, out: 0 };
    d.n = r.n;
    wkAgg.set(k, d);
  }
  for (const r of wkTxRows.rows) {
    const k = wkKey(r.wk);
    if (!k) continue;
    const d = wkAgg.get(k) ?? { acts: [], n: 0, out: 0 };
    d.out = r.out_cents;
    wkAgg.set(k, d);
  }
  const [yy, mm] = month.split("-").map(Number);
  const firstDow = (new Date(yy, mm - 1, 1).getDay() + 6) % 7; // 周一为 0
  const weekKeys: string[] = [];
  for (let t = new Date(yy, mm - 1, 1).getTime() - firstDow * 86_400_000; t <= new Date(yy, mm, 0).getTime(); t += 7 * 86_400_000) {
    weekKeys.push(localYmd(new Date(t)));
  }
  const weekLines = weekKeys.map((k) => {
    const d = wkAgg.get(k) ?? { acts: [], n: 0, out: 0 };
    const bits = [d.acts.join("、"), d.n ? `动态${d.n}条` : "", d.out ? `支出¥${(d.out / 100).toFixed(0)}` : ""].filter(Boolean);
    return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}周：${bits.length ? bits.join(" · ") : "无记录"}`;
  });
  const facts = [
    `周期：${month}月（${from} 至 ${to}）`,
    `时间投入：${timeParts.length ? timeParts.join("、") : "无"}`,
    `完成待办：${todoRows.rows[0].n} 件`,
    `支出 ¥${(txRows.rows[0].out_cents / 100).toFixed(0)} · 收入 ¥${(txRows.rows[0].in_cents / 100).toFixed(0)}`,
    interactRows.rows.length ? `人际互动：${interactRows.rows.map((r) => `${r.name}${r.n}次`).join("、")}` : "人际互动：无",
    `动态 ${entryRows.rows[0].n} 条（覆盖 ${entryRows.rows[0].days} 天）${entryRows.rows[0].moods.length ? `（心情：${entryRows.rows[0].moods.join("、")}）` : ""}`,
    "每周对比：",
    ...weekLines,
  ];

  const system = `你是个人经营助手「拾光复利」，为用户做**每月复盘**。输入是该用户本月的全部真实记录：原始动态（含发布时间与心情标注）、每周对比、日程块、完成待办、聚合统计，可能还有各周小结。请依次判断：
1. 本月心情状况与曲线（结合心情标注与原文语气，指出低谷与高涨出现在何时）；
2. 主要时间花销去了哪里、各周如何变化；
3. 写出总结、做得好的地方、下月可改进的建议。
只依据事实归纳，**严禁编造**；语气温和务实，不灌鸡汤。全文 500 字左右。sections 分 3 节左右（时间结构/心情曲线/财务与人际），每节 title≤8字、text≤160字。严格输出 JSON：
{
  "summary": "本月总述，≤120字，突出心情曲线与时间结构",
  "sections": [ { "title": "时间结构", "text": "该节展开" } ],
  "highlights": ["做得好的地方，最多4条，每条≤30字"],
  "suggestions": ["下月可改进的建议，最多3条，每条≤30字，没有依据就空数组"]
}`;

  // ---- 小结链（已有周小结才带）+ 画像注入 ----
  const chainLines = await fetchChainSummaries(
    user.id,
    "month",
    weekKeys.map((k) => ({ key: k, label: `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}周` })),
  );
  const profileBlock = await loadProfileBlock(user.id);


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

  // ---- 原始明细文本块 ----
  const detailText = [
    ["原始动态（时间 原文 心情）：", ...withCap(entryLines(rawEntryRows.rows), ENTRY_CAPS.month, "条动态")].join("\n"),
    ["日程块：", ...withCap(blockLines(blockRows.rows), BLOCK_CAPS.month, "个日程")].join("\n") || "日程块：无",
    ["完成待办：", ...withCap(todoDoneLines(todoListRows.rows), TODO_CAPS.month, "条待办")].join("\n") || "完成待办：无",
  ].join("\n\n");
  const userPrompt = [
    facts.join("\n"),
    chainLines.length ? "本月各周小结：\n" + chainLines.join("\n") : null,
    detailText,
    profileBlock ? `该用户的已知画像（供理解参考，不要复述）：\n${profileBlock}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    result = await getOrGenerateReview(user.id, "month", month, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      const parsed = await chatReviewJson<Partial<MonthReview>>({
        system,
        user: userPrompt,
        maxTokens: 2500,
        timeoutMs: 60_000,
        onUsage: capture,
      });
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, n) : []);
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .filter((s) => s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string")
          .slice(0, 4)
          .map((s) => ({ title: String(s.title).slice(0, 12), text: String(s.text).slice(0, 220) }))
      : [];
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 160)
          : "这个月记录还很少，多记几天再来复盘会更有料",
      sections,
      highlights: arr(parsed.highlights, 4),
      suggestions: arr(parsed.suggestions, 3),
    };
    });
  } catch {
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  // ---- 画像更新（越用越懂用户）：月报生成成功后合并记忆，异步不阻塞响应 ----
  if (!cached) {
    const reviewText = JSON.stringify(review);
    void updateProfileFromReview(user.id, `${month}月`, userPrompt, reviewText);
  }

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
}
