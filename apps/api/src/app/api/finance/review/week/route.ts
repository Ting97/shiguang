import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { hasApiKey } from "@shiguangri/ai";
import { getModuleUser } from "@/lib/modules";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import { acquireGeneration, consumeGeneration, ReviewGateError } from "@/lib/review-quota";
import { getPromptBundle, assembleUserPrompt } from "@/lib/prompts";
import { chatReviewJson } from "@/lib/review-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Asia/Shanghai";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const mondayOf = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
};
const addDays = (dateStr: string, n: number) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const yuan = (cents: number) => `¥${(cents / 100).toFixed(0)}`;

interface WeekReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/** GET /api/finance/review/week?date= —— 只读缓存（不调 LLM、不耗配额）；无缓存返回 {review:null} */
export async function GET(req: Request) {
  const user = await getModuleUser("trade_review");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通交易复盘模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("date") ?? bjToday();
  const anchor = DATE_RE.test(q) ? q : bjToday();
  const from = mondayOf(anchor);
  const hit = await pool.query(
    `select review, updated_at from review_caches where user_id = $1 and kind = 'trade_week' and period_key = $2`,
    [user.id, from],
  );
  if (!hit.rows[0]) return NextResponse.json({ review: null });
  return NextResponse.json({
    review: hit.rows[0].review,
    cached: true,
    generatedAt: new Date(hit.rows[0].updated_at).toISOString(),
    range: { from, to: addDays(from, 6) },
  });
}

/** POST /api/finance/review/week {date?, refresh?} —— AI 交易周报（FR-C2.7 ②）
 * 复用复盘管线：review_caches(kind='trade_week') 缓存 + review_gen_quotas 周池 + /admin 可调 prompt。 */
export async function POST(req: Request) {
  const user = await getModuleUser("trade_review");
  if (!user) {
    const cur = await getCurrentUser();
    return NextResponse.json(
      { error: cur ? "未开通交易复盘模块" : "未登录" },
      { status: cur ? 403 : 401 },
    );
  }
  if (user.role !== "admin") {
    const q = await checkAiQuota(user.id);
    if (!q.allowed) {
      return NextResponse.json(
        { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`, quota: q },
        { status: 402 },
      );
    }
  }
  const { date, refresh } = (await req.json().catch(() => ({}))) as { date?: string; refresh?: boolean };
  const anchor = date && DATE_RE.test(date) ? date : bjToday();
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const from = mondayOf(anchor);
  const to = addDays(from, 6);

  const bundle = await getPromptBundle("trade_review_week");
  const injectTx = bundle.config.inject.txDetail;
  const txCap = bundle.config.caps.txCap;

  // ---- 事实聚合（必需）----
  const agg = (
    await pool.query(
      `select coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
              coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out,
              count(*)::int as n
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, from, to],
    )
  ).rows[0];
  const prev = (
    await pool.query(
      `select coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
              coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, addDays(from, -7), addDays(from, -1)],
    )
  ).rows[0];
  const cats = (
    await pool.query(
      `select category, sum(case when direction = 'out' then amount_cents else 0 end)::bigint as cents
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date
       group by category order by cents desc limit 5`,
      [user.id, TZ, from, to],
    )
  ).rows;
  const momPct = (cur: number, base: number) =>
    base > 0 ? `${cur >= base ? "+" : ""}${Math.round(((cur - base) / base) * 100)}%` : "—";

  const factLines = [
    `交易周报 · 本周 ${from} ~ ${to}（周一至周日）`,
    `总支出 ${yuan(Number(agg.out))}（上周 ${yuan(Number(prev.out))}，环比 ${momPct(Number(agg.out), Number(prev.out))}）`,
    `总收入 ${yuan(Number(agg.inc))}（上周 ${yuan(Number(prev.inc))}，环比 ${momPct(Number(agg.inc), Number(prev.inc))}）`,
    `笔数：共 ${agg.n} 笔`,
  ];
  if (cats.length > 0) {
    factLines.push(
      `支出分类 Top：${cats.map((c) => `${c.category} ${yuan(Number(c.cents))}`).join("、")}`,
    );
  }
  const facts = factLines.join("\n");

  // ---- 流水明细（可关；cap 下沉 SQL LIMIT + 截断注记）----
  let txDetail = "";
  if (injectTx && txCap !== 0) {
    const rows = (
      await pool.query(
        `select to_char((occurred_at at time zone $2)::date, 'MM-DD') as d, direction, amount_cents, category, counterparty, note
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date
         order by occurred_at
         limit $5`,
        [user.id, TZ, from, to, txCap],
      )
    ).rows;
    const total = (
      await pool.query(
        `select count(*)::int as n from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date`,
        [user.id, TZ, from, to],
      )
    ).rows[0].n;
    const lines = rows.map(
      (r) =>
        `${r.d} ${r.direction === "out" ? "-" : "+"}${yuan(Number(r.amount_cents))} ${r.category}` +
        `${r.counterparty ? ` ${r.counterparty}` : ""}${r.note ? `（${r.note}）` : ""}`,
    );
    if (total > rows.length) lines.push(`（另有 ${total - rows.length} 条流水未展示）`);
    txDetail = lines.length > 0 ? `本周流水（时间升序）：\n${lines.join("\n")}` : "本周无流水明细。";
  }

  const userPrompt = assembleUserPrompt("trade_review_week", bundle, { facts, txDetail });

  // 数据新鲜度：本周流水最后一次入库时间
  const latest = (
    await pool.query(
      `select max(created_at) as t from transactions
       where user_id = $1 and (occurred_at at time zone $2)::date between $3::date and $4::date`,
      [user.id, TZ, from, to],
    )
  ).rows[0].t;

  let result;
  try {
    result = await getOrGenerateReview(user.id, "trade_week", from, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "trade_week", from, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<WeekReview>>({
        system: bundle.system,
        user: userPrompt,
        maxTokens: 800,
        timeoutMs: 45_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 34)).filter(Boolean).slice(0, n) : []);
      await consumeGeneration(user.id, "trade_week", from);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 120)
            : "本周流水还很少，多记几笔再来复盘会更有料",
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
