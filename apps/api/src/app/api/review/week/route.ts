import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import { acquireGeneration, consumeGeneration, ReviewGateError } from "@/lib/review-quota";
import {
  BLOCK_CAPS, ENTRY_CAPS, TODO_CAPS,
  blockLines, chatReviewJson, entryLines, fetchChainSummaries, loadProfileBlock, todoDoneLines, withCap,
} from "@/lib/review-input";

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
  if (user.id !== DEV_USER_ID) {
    const q = await checkAiQuota(user.id);
    if (!q.allowed) {
      return NextResponse.json(
        { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`, quota: q },
        { status: 402 },
      );
    }
  }
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

  const [timeRows, todoRows, txRows, interactRows, entryRows, dayTimeRows, dayEntryRows, dayTxRows, rawEntryRows, blockRows, todoListRows] = await Promise.all([
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

  const system = `你是个人经营助手「拾光复利」，为用户做**每周复盘**。输入是该用户本周的全部真实记录：原始动态（含发布时间与心情标注）、每日明细、日程块、完成待办、聚合统计，可能还有各日小结。请依次判断：
1. 本周心情状况与起伏（结合心情标注与原文语气，可指出具体哪天低落/高涨）；
2. 主要时间花销去了哪里、节奏如何；
3. 总结这一周，说出做得好的地方，给出下周可改进的建议。
只依据事实归纳对比，**严禁编造**；语气温和务实，不灌鸡汤。全文 200 字左右。严格输出 JSON：
{
  "summary": "本周总结，≤120字，突出心情起伏与时间结构",
  "highlights": ["做得好的地方，最多3条，每条≤24字，可引用具体某天"],
  "suggestions": ["下周可改进的建议，最多2条，每条≤24字，没有依据就空数组"]
}`;

  // ---- 小结链（已有日小结才带）+ 画像注入 ----
  const chainLines = await fetchChainSummaries(
    user.id,
    "week",
    Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday.getTime() + i * 86_400_000);
      return { key: localYmd(day), label: `${WD[i]}(${Number(localYmd(day).slice(5, 7))}/${Number(localYmd(day).slice(8, 10))})` };
    }),
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
    ["原始动态（时间 原文 心情）：", ...withCap(entryLines(rawEntryRows.rows), ENTRY_CAPS.week, "条动态")].join("\n"),
    ["日程块：", ...withCap(blockLines(blockRows.rows), BLOCK_CAPS.week, "个日程")].join("\n") || "日程块：无",
    ["完成待办：", ...withCap(todoDoneLines(todoListRows.rows), TODO_CAPS.week, "条待办")].join("\n") || "完成待办：无",
  ].join("\n\n");
  const userPrompt = [
    facts.join("\n"),
    chainLines.length ? "本周各日小结：\n" + chainLines.join("\n") : null,
    detailText,
    profileBlock ? `该用户的已知画像（供理解参考，不要复述）：\n${profileBlock}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    result = await getOrGenerateReview(user.id, "week", from, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "week", from, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<WeekReview>>({
        system,
        user: userPrompt,
        maxTokens: 1300,
        timeoutMs: 45_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 34)).filter(Boolean).slice(0, n) : []);
      await consumeGeneration(user.id, "week", from);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 150)
            : "这一周记录还很少，多记几天再来复盘会更有料",
        highlights: arr(parsed.highlights, 3),
        suggestions: arr(parsed.suggestions, 2),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
}
