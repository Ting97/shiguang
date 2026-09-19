import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chat, extractJson, hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";

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
  const { date, refresh } = (await req.json().catch(() => ({}))) as { date?: string; refresh?: boolean };
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  // ---- 当天事实聚合（全部按北京日切）----
  const [timeRows, todoRows, txRows, interactRows, entryRows, kcalRows] = await Promise.all([
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

  const system = `你是个人经营助手「拾光复利」，基于用户一天的**真实记录**写一份简短日小结。只依据事实归纳，**严禁编造**；语气温和务实，不灌鸡汤。严格输出 JSON：
{
  "summary": "这一天的一句话总结（≤50字，突出时间去向和状态）",
  "highlights": ["值得肯定的亮点，最多3条，没有就空数组"],
  "suggestions": ["明天可改进的具体建议，最多2条，没有依据就空数组"]
}`;

  const { review, cached } = await getOrGenerateReview(user.id, "day", date, refresh === true, async () => {
    const raw = await chat({
      system,
      user: facts.join("\n"),
      temperature: 0.4,
      maxTokens: 500,
      timeoutMs: 45_000,
    });
    const parsed = extractJson(raw) as Partial<DayReview>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 50)).filter(Boolean).slice(0, 3) : []);
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 80)
          : "这一天记录还很少，多记几句再来复盘会更有料",
      highlights: arr(parsed.highlights),
      suggestions: arr(parsed.suggestions),
    };
  });

  return NextResponse.json({ review, cached, facts: { timeParts, todoDone: todoRows.rows[0].n } });
}
