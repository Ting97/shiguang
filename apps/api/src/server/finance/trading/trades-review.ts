/**
 * R1 digest（规则统计素材，零 LLM）+ AI 复盘管线（REQ-005 FR-1.7）。
 * AI 复盘复用 insight 复盘管线：review_caches(kind='trading') 缓存 + review_gen_quotas 配额 + prompt 纳管。
 */
import { pool } from "@/server/platform/db";
import { hasApiKey } from "@shiguangri/ai";
import { ApiError } from "@/server/platform/http/errors";
import { getOrGenerateReview, acquireGeneration, consumeGeneration, ReviewGateError, chatReviewJson } from "@/server/insight";
import { checkAiQuota, getPromptBundle, assembleUserPrompt } from "@/server/ai";
import { equityCurve, listTrades, TZ } from "./trades";

const money = (n: number) => `$${n.toFixed(2)}`;

/** 规则统计素材：权益概况/回撤点名/两阶段对比/归类聚合/典型逐笔 */
export async function buildDigest(userId: string, accountId: string) {
  const eq = await equityCurve(userId, accountId);
  const recent = await listTrades(userId, { accountId });
  const agg = async (label: string, sql: string) => {
    const { rows } = await pool.query(sql, [userId, accountId]);
    return { label, rows: rows.map((r) => ({ ...r, net: Number(r.net), count: Number(r.count) })) };
  };
  const byPeriod = await agg(
    "开仓时段",
    `select case when extract(hour from (close_time at time zone '${TZ}')) between 6 and 11 then 'morning'
                 when extract(hour from (close_time at time zone '${TZ}')) between 12 and 17 then 'afternoon'
                 when extract(hour from (close_time at time zone '${TZ}')) between 18 and 23 then 'evening'
                 else 'lateNight' end as bucket,
             count(*)::int as count, sum(net_profit) as net
     from trades where user_id = $1 and account_id = $2 group by 1 order by net desc`,
  );
  const byDur = await agg(
    "持仓时长",
    `select case when extract(epoch from (close_time - open_time)) / 60 < 15 then 'lt15m'
                 when extract(epoch from (close_time - open_time)) / 60 between 15 and 60 then 'm15to60'
                 when extract(epoch from (close_time - open_time)) / 60 between 60 and 240 then 'h1to4'
                 else 'gt4h' end as bucket,
             count(*)::int as count, sum(net_profit) as net
     from trades where user_id = $1 and account_id = $2 group by 1 order by net desc`,
  );
  const byDir = await agg(
    "方向",
    `select direction as bucket, count(*)::int as count, sum(net_profit) as net
     from trades where user_id = $1 and account_id = $2 group by 1`,
  );
  const notable = (
    await pool.query(
      `(select '最大盈利' as label, ticket, symbol, direction, lots, net_profit, close_time from trades
        where user_id = $1 and account_id = $2 order by net_profit desc limit 3)
       union all
       (select '最大亏损', ticket, symbol, direction, lots, net_profit, close_time from trades
        where user_id = $1 and account_id = $2 order by net_profit asc limit 3)
       union all
       (select '最长持仓', ticket, symbol, direction, lots, net_profit, close_time from trades
        where user_id = $1 and account_id = $2 order by close_time - open_time desc limit 1)`,
      [userId, accountId],
    )
  ).rows.map((r) => ({
    label: r.label,
    ticket: String(r.ticket),
    symbol: r.symbol,
    direction: r.direction,
    lots: Number(r.lots),
    netProfit: Number(r.net_profit),
    closeTime: new Date(r.close_time).toISOString(),
  }));

  const totalTrades = recent.total;
  const drawdownLines = eq.drawdowns.map(
    (d, i) => `${i + 1}. ${d.startYmd} → ${d.troughYmd}（回落 ${money(d.amount)}，至 ${d.endYmd} 收复/止跌）`,
  );
  const phaseLine = `峰值前（至 ${eq.peak?.ymd ?? "—"}）：${eq.phases.beforePeak.count} 笔 / 胜率 ${eq.phases.beforePeak.winRate ?? "—"}% / 净 ${money(eq.phases.beforePeak.net)}；峰值后：${eq.phases.afterPeak.count} 笔 / 胜率 ${eq.phases.afterPeak.winRate ?? "—"}% / 净 ${money(eq.phases.afterPeak.net)}`;
  const bucketLabel: Record<string, string> = {
    morning: "早晨(6-12点)", afternoon: "午后(12-18点)", evening: "晚间(18-24点)", lateNight: "深夜(0-6点)",
    lt15m: "<15分钟", m15to60: "15-60分钟", h1to4: "1-4小时", gt4h: ">4小时",
    buy: "买入", sell: "卖出",
  };
  const factLines = [
    `交易账号复盘 · 共 ${totalTrades} 笔，累计净盈亏 ${money(eq.totalNet)}`,
    eq.peak ? `权益峰值 ${money(eq.peak.cum)}（${eq.peak.ymd}）` : "暂无权益峰值",
    eq.drawdowns.length ? `最大回撤段：\n${drawdownLines.join("\n")}` : "无显著回撤段",
    phaseLine,
    ...[byPeriod, byDur, byDir].map((g) => `${g.label}分布：${g.rows.map((r) => `${bucketLabel[r.bucket] ?? r.bucket} ${r.count}笔/${money(r.net)}`).join("、") || "无"}`),
  ];

  return {
    accountId,
    stats: { totalTrades, totalNet: eq.totalNet, peak: eq.peak, drawdowns: eq.drawdowns, phases: eq.phases },
    aggregations: { byPeriod: byPeriod.rows, byDuration: byDur.rows, byDirection: byDir.rows },
    notable,
    facts: factLines.join("\n"),
  };
}

interface TradingReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/** GET 侧：只读缓存 */
export async function getTradingReviewCache(userId: string, accountId: string) {
  const hit = await pool.query(
    `select review, updated_at from review_caches where user_id = $1 and kind = 'trading' and period_key = $2`,
    [userId, accountId],
  );
  if (!hit.rows[0]) return { review: null };
  return {
    review: hit.rows[0].review,
    cached: true,
    generatedAt: new Date(hit.rows[0].updated_at).toISOString(),
  };
}

/** POST 侧：生成（缓存命中秒回——先于额度/KEY 门槛，额度用尽的用户也能读到已有复盘；仅真正需要生成时才 checkAiQuota） */
export async function generateTradingReview(userId: string, accountId: string, role: string, refresh: boolean) {
  // 数据新鲜度：该账号最后一笔平仓时间（缓存命中判定与 getOrGenerateReview 同口径）
  const latest = (
    await pool.query(`select max(close_time) as t from trades where user_id = $1 and account_id = $2`, [userId, accountId])
  ).rows[0].t;
  const latestAt = latest ? new Date(latest) : null;

  if (refresh !== true) {
    const hit = await pool.query(
      `select review, updated_at from review_caches where user_id = $1 and kind = 'trading' and period_key = $2`,
      [userId, accountId],
    );
    const row = hit.rows[0];
    // 缓存生成后周期内无新记录才算命中；过期缓存走下方生成链路自动重算
    if (row && (latestAt == null || new Date(row.updated_at) >= latestAt)) {
      return {
        review: row.review as TradingReview,
        cached: true,
        generatedAt: new Date(row.updated_at).toISOString(),
        digest: await buildDigest(userId, accountId),
      };
    }
  }

  if (role !== "admin") {
    const q = await checkAiQuota(userId);
    if (!q.allowed) {
      throw new ApiError(402, "quota", `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`);
    }
  }
  if (!hasApiKey()) throw new ApiError(503, "upstream", "未配置 AI 服务");

  const bundle = await getPromptBundle("trading_review");
  const digest = await buildDigest(userId, accountId);
  const userPrompt = await assembleUserPrompt("trading_review", bundle, { facts: digest.facts }, { userId });

  let result;
  try {
    result = await getOrGenerateReview(userId, "trading", accountId, refresh === true, latestAt, async (capture) => {
      await acquireGeneration(userId, "trading", accountId, latestAt);
      const parsed = await chatReviewJson<Partial<TradingReview>>({
        system: bundle.system,
        user: userPrompt,
        maxTokens: 900,
        timeoutMs: 45_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, n) : []);
      await consumeGeneration(userId, "trading", accountId);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 160)
            : "交易样本还少，继续导入账单后再来看复盘结论",
        highlights: arr(parsed.highlights, 3),
        suggestions: arr(parsed.suggestions, 3),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) throw new ApiError(429, "quota", e.message);
    throw e instanceof ApiError ? e : new ApiError(502, "upstream", "AI 解读失败，请稍后重试");
  }
  return { ...result, digest };
}
