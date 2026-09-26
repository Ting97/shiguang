import { useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh, useReachBottom } from "@tarojs/taro";
import { bjToday, loadTradingAccounts, loadTradingDaily, loadTradingEquity, loadTradingTrades, loadTradingReview } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { loadTradingDigest, genTradingReview, type TradingDigest, type TradingReviewBody, type DigestAggRow } from "./api";
import "./index.scss";

/**
 * MT5 交易只读分包页（无任何写/导入入口）：账号 chips → 汇总卡 → 近 30 日每日盈亏柱状 →
 * 累计收益曲线 → digest 摘要 → AI 复盘（fallback=true 显降级徽标）→ 逐笔明细分页。
 * 取数窗口/错误处理对齐 apps/mobile App.tsx Trades；UI 按 miniapp 约定（card 类 + 页面私有 scss）。
 * 坑：交易金额是 USD 原币数值（不是分），显示用 usd() 而非 yuan()。
 */

interface TradeAccount {
  id: string;
  login: string;
  nickname: string | null;
  trades: number;
  lots: number;
  netProfit: number;
  winRate: number | null;
}
interface DailyRow {
  ymd: string;
  net: number;
  count: number;
}
interface EquityPoint {
  ymd: string;
  cum: number;
}
interface TradeItem {
  id: string;
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  closeTime: string;
  lots: number;
  netProfit: number;
  holdMinutes: number;
}

/** 北京日历日 ±n 天（UTC getter，防东八区偏移；与 shared/date 同口径） */
function bjShiftDays(n: number): string {
  return new Date(Date.parse(`${bjToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** USD 金额：MT5 原币数值非分，两位小数 + $ 前缀（负号在 $ 前，对齐 Expo 端） */
function usd(v: number): string {
  const n = Number(v) || 0;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}
/** ISO → 北京 M/D HH:mm（+8h 后取 UTC 字段，禁本地 getter） */
function bjDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}

/** digest 分组桶 → 中文（与服务端 trades-review bucketLabel 同源） */
const BUCKET_LABEL: Record<string, string> = {
  morning: "早晨", afternoon: "午后", evening: "晚间", lateNight: "深夜",
  lt15m: "<15分", m15to60: "15-60分", h1to4: "1-4时", gt4h: ">4时",
  buy: "买入", sell: "卖出",
};
const aggLine = (label: string, rows: DigestAggRow[]) =>
  `${label}：${rows.length > 0 ? rows.map((r) => `${BUCKET_LABEL[r.bucket] ?? r.bucket} ${r.count}笔/${usd(r.net)}`).join("、") : "无"}`;

const TRADES_PAGE_SIZE = 20; // 服务端 listTrades 固定 20/页
const CURVE_MAX_BARS = 40; // 权益点可能上百：均匀抽样到 ≤40 根柱，View 数量可控

export default function TradingPage() {
  const [accounts, setAccounts] = useState<TradeAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [days, setDays] = useState<DailyRow[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [digest, setDigest] = useState<TradingDigest | null>(null);
  const [review, setReview] = useState<TradingReviewBody | null>(null);
  const [reviewMeta, setReviewMeta] = useState<{ cached: boolean; generatedAt?: string } | null>(null);
  // 降级徽标：POST 返回 fallback=true 时置位（AI 配额/限频/上游挂掉的服务端规则版兜底）
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? null;

  /** 逐笔明细单页拉取：append=false 重置列表（切号/下拉刷新） */
  async function loadTrades(id: string, page: number, append: boolean) {
    // 服务端实际返回 {total, page, pageSize, items}；lib 类型写的 {trades} 是旧口径，按实际结构取
    const r = (await loadTradingTrades(id, page)) as unknown as { total?: number; items?: TradeItem[]; trades?: TradeItem[] };
    const list = r.items ?? r.trades ?? [];
    setTradeTotal(r.total ?? list.length);
    setTrades((prev) => (append ? [...prev, ...list] : list));
    return list.length;
  }

  /** 拉某账号全部视图数据：图表/明细失败向上抛（外层给重试横幅）；digest/复盘失败降级为卡内提示，不整页报错 */
  async function loadAccount(id: string) {
    const from = bjShiftDays(-29);
    const to = bjToday();
    const [dailyR, equityR, , digestR, reviewR] = await Promise.all([
      loadTradingDaily(id, from, to),
      loadTradingEquity(id),
      loadTrades(id, 1, false),
      loadTradingDigest(id).catch(() => null),
      // GET 只读缓存不耗配额：先读，没有再由用户点「生成复盘」
      loadTradingReview(id).catch(() => null),
    ]);
    setDays((dailyR.days ?? []) as DailyRow[]);
    setEquity((equityR.points ?? []) as EquityPoint[]);
    setDigest(digestR);
    const rv = reviewR as unknown as { review: TradingReviewBody | null; cached?: boolean; generatedAt?: string } | null;
    if (rv?.review) {
      setReview(rv.review);
      setReviewMeta({ cached: rv.cached !== false, generatedAt: rv.generatedAt });
    } else {
      setReview(null);
      setReviewMeta(null);
    }
    setFallbackReason(null);
    setReviewErr(null);
  }

  /** 入口刷新：账号列表 + 当前账号数据；切号保号（刷新后仍选中原来的） */
  async function refresh() {
    const acc = await loadTradingAccounts();
    const list = (acc.accounts ?? []) as TradeAccount[];
    setAccounts(list);
    const nextId = accountId && list.some((a) => a.id === accountId) ? accountId : list[0]?.id ?? null;
    setAccountId(nextId);
    if (nextId) {
      await loadAccount(nextId);
    } else {
      // 无账号：清空所有派生状态，避免展示上一个用户/旧数据残留
      setDays([]); setEquity([]); setTrades([]); setTradeTotal(0); setDigest(null);
      setReview(null); setReviewMeta(null); setFallbackReason(null);
    }
    setMsg(null);
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    // 首屏没有骨架屏，失败走横幅 + 空态文案（对齐 finance 页的轻量做法）
    refresh().catch((e: any) => setMsg(e?.message ?? "加载失败"));
  }

  usePullDownRefresh(() => {
    refresh()
      .catch((e: any) => setMsg(e?.message ?? "刷新失败"))
      .finally(() => Taro.stopPullDownRefresh());
  });

  async function switchAccount(id: string) {
    if (id === accountId) return;
    setAccountId(id);
    setReview(null); setReviewMeta(null); setFallbackReason(null); setReviewErr(null);
    try {
      await loadAccount(id);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
  }

  /** 触底翻页：20/页，拉满 total 或拿到不足一页即止 */
  useReachBottom(() => {
    if (!accountId || loadingMore || genBusy) return;
    if (trades.length === 0 || trades.length >= tradeTotal) return;
    setLoadingMore(true);
    const nextPage = Math.floor(trades.length / TRADES_PAGE_SIZE) + 1;
    loadTrades(accountId, nextPage, true)
      .catch(() => {
        /* 加载更多失败静默，下次触底重试（对齐 feed 页） */
      })
      .finally(() => setLoadingMore(false));
  });

  /** 生成/刷新 AI 复盘：refresh=true 绕过缓存。降级响应（fallback=true）带规则版 digest 回来，顺手刷新摘要 */
  async function generate() {
    if (!accountId || genBusy) return;
    setGenBusy(true);
    setReviewErr(null);
    try {
      const r = await genTradingReview(accountId, true);
      if (r.fallback) {
        setReview(null);
        setReviewMeta(null);
        setFallbackReason(r.fallbackReason ?? "AI 暂不可用，已降级为规则摘要");
        if (r.digest) setDigest(r.digest);
      } else {
        setFallbackReason(null);
        if (r.review) {
          setReview(r.review);
          setReviewMeta({ cached: !!r.cached, generatedAt: r.generatedAt });
        }
      }
    } catch (e: any) {
      setReviewErr(e?.message ?? "生成失败");
    } finally {
      setGenBusy(false);
    }
  }

  /* —— 图表数据映射（纯计算） —— */
  // 近 30 日合计（标题右侧角标）
  const days30Total = days.reduce((s, d) => s + (Number(d.net) || 0), 0);
  // 每日盈亏柱：中线为 0 轴，正柱向上（绿）负柱向下（红），高度∝|net|/maxAbs
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(Number(d.net) || 0)));
  const barOf = (net: number) => `${Math.max(6, Math.round((Math.abs(Number(net) || 0) / maxAbs) * 110))}px`;
  // 累计曲线：服务端 points 已按日升序且 cum 已算好；这里只做均匀抽样 + 高度归一
  const eqStep = Math.max(1, Math.ceil(equity.length / CURVE_MAX_BARS));
  const sampled = equity.filter((_, i) => i % eqStep === 0 || i === equity.length - 1);
  const cumMax = Math.max(0, ...sampled.map((p) => p.cum));
  const cumMin = Math.min(0, ...sampled.map((p) => p.cum));
  const cumRange = cumMax - cumMin || 1;
  const cumTotal = equity.length > 0 ? equity[equity.length - 1].cum : 0;

  const summary = digest?.stats;

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      {/* 账号 chips：多账号才显示（单号无切换意义，对齐 Expo 端） */}
      {accounts.length > 1 && (
        <View className="chips">
          {accounts.map((a) => (
            <Text key={a.id} className={`chip ${a.id === accountId ? "chip-on" : ""}`} onClick={() => switchAccount(a.id)}>
              {a.nickname || a.login}
            </Text>
          ))}
        </View>
      )}

      {accounts.length === 0 && !msg && (
        <View className="card">
          <Text className="dim">还没有交易账号 —— 请先在网页端导入 MT5 账单（此处只读）</Text>
        </View>
      )}

      {/* 汇总卡：净值口径=累计净盈亏（MT5 净值快照不入库，无实时净值） */}
      {account && (
        <View className="card">
          <View className="sum-head">
            <Text className="dim">总净盈亏</Text>
            <Text className="dim">{account.nickname || account.login}</Text>
          </View>
          <Text className={`sum-net ${account.netProfit >= 0 ? "money-in" : "money-out"}`}>{usd(account.netProfit)}</Text>
          <View className="sum-grid">
            <View className="sum-cell">
              <Text className="sum-num">{account.winRate == null ? "—" : `${account.winRate}%`}</Text>
              <Text className="dim">胜率</Text>
            </View>
            <View className="sum-cell">
              <Text className="sum-num">{Number(account.trades) || 0}</Text>
              <Text className="dim">笔数</Text>
            </View>
            <View className="sum-cell">
              <Text className="sum-num">{(Number(account.lots) || 0).toFixed(2)}</Text>
              <Text className="dim">手数</Text>
            </View>
          </View>
        </View>
      )}

      {/* 近 30 日每日盈亏：中线 0 轴柱状，正绿负红 */}
      <View className="card">
        <View className="sec-head">
          <Text className="h2">📊 近 30 日每日盈亏</Text>
          {days.length > 0 && (
            <Text className={`h2 ${days30Total >= 0 ? "money-in" : "money-out"}`}>{usd(days30Total)}</Text>
          )}
        </View>
        {days.length === 0 ? (
          <Text className="dim">近 30 日暂无交易</Text>
        ) : (
          <>
            <View className="bars">
              {days.map((d) => (
                <View key={d.ymd} className="bar-col">
                  <View className="bar-half up">{Number(d.net) > 0 && <View className="bar up" style={{ height: barOf(d.net) }} />}</View>
                  <View className="bar-half down">{Number(d.net) < 0 && <View className="bar down" style={{ height: barOf(d.net) }} />}</View>
                </View>
              ))}
            </View>
            <View className="bar-labels">
              <Text className="dim">{days[0].ymd.slice(5)}</Text>
              <Text className="dim">{days[days.length - 1].ymd.slice(5)}</Text>
            </View>
          </>
        )}
      </View>

      {/* 累计收益曲线：全历史权益点抽样成柱（绿正红负），底部对齐 */}
      <View className="card">
        <View className="sec-head">
          <Text className="h2">📈 累计收益</Text>
          {equity.length > 0 && (
            <Text className={`h2 ${cumTotal >= 0 ? "money-in" : "money-out"}`}>{usd(cumTotal)}</Text>
          )}
        </View>
        {sampled.length === 0 ? (
          <Text className="dim">暂无权益数据</Text>
        ) : (
          <>
            <View className="bars baseline">
              {sampled.map((p) => (
                <View
                  key={p.ymd}
                  className={`curve-bar ${p.cum >= 0 ? "up" : "down"}`}
                  style={{ height: `${Math.max(6, Math.round(((p.cum - cumMin) / cumRange) * 110))}px` }}
                />
              ))}
            </View>
            <View className="bar-labels">
              <Text className="dim">{sampled[0].ymd.slice(0, 7)}</Text>
              <Text className="dim">{sampled[sampled.length - 1].ymd.slice(0, 7)}</Text>
            </View>
          </>
        )}
      </View>

      {/* digest 规则摘要：峰值/回撤/时段·时长·方向聚合（零 AI 消耗） */}
      {summary && (
        <View className="card">
          <Text className="h2">🧮 规则摘要</Text>
          <Text className="digest-line">
            共 {summary.totalTrades} 笔 · 累计 {usd(summary.totalNet)}
            {summary.peak ? ` · 峰值 ${usd(summary.peak.cum)}（${summary.peak.ymd}）` : ""}
          </Text>
          {summary.drawdowns.length > 0 && (
            <Text className="digest-line">
              最大回撤 {usd(summary.drawdowns[0].amount)}（{summary.drawdowns[0].startYmd} → {summary.drawdowns[0].troughYmd}）
            </Text>
          )}
          <Text className="digest-line dim">{aggLine("方向", digest!.aggregations.byDirection)}</Text>
          <Text className="digest-line dim">{aggLine("时段", digest!.aggregations.byPeriod)}</Text>
          <Text className="digest-line dim">{aggLine("持仓时长", digest!.aggregations.byDuration)}</Text>
        </View>
      )}

      {/* AI 复盘：正常展示 review；fallback=true 显降级徽标；错误徽标直出服务端文案 */}
      <View className="card">
        <View className="sec-head">
          <Text className="h2">🤖 AI 复盘</Text>
          <Text
            className={`ai-btn ${genBusy ? "disabled" : ""}`}
            onClick={generate}
          >
            {genBusy ? "生成中…" : review ? "重新生成" : "生成复盘"}
          </Text>
        </View>
        {reviewMeta && review && (
          <Text className="dim">{reviewMeta.cached ? "缓存" : "已生成"}{reviewMeta.generatedAt ? ` · ${bjDateTime(reviewMeta.generatedAt)}` : ""}</Text>
        )}
        {fallbackReason && (
          <View className="badge-warn">⚡ 降级 · {fallbackReason}</View>
        )}
        {reviewErr && <View className="banner banner-err">{reviewErr}</View>}
        {genBusy && !review && <Text className="dim ai-busy">正在汇总交易记录并生成解读…</Text>}
        {review ? (
          <View className="ai-body">
            <Text className="ai-summary">{review.summary}</Text>
            {review.highlights?.length > 0 && (
              <View className="ai-list">
                {review.highlights.map((h, i) => (
                  <Text key={i} className="ai-line"><Text className="mk money-in">◆</Text>{h}</Text>
                ))}
              </View>
            )}
            {review.suggestions?.length > 0 && (
              <View className="ai-list ai-sug">
                {review.suggestions.map((s, i) => (
                  <Text key={i} className="ai-line dim"><Text className="mk">✦</Text>{s}</Text>
                ))}
              </View>
            )}
          </View>
        ) : (
          !genBusy && !fallbackReason && !reviewErr && accountId && (
            <Text className="dim">点「生成复盘」让 AI 解读交易记录（走 AI 配额，结果缓存）</Text>
          )
        )}
      </View>

      {/* 逐笔明细：分页 20/页，触底加载更多 */}
      <View className="card">
        <Text className="h2">📋 逐笔明细{tradeTotal > 0 ? ` ${tradeTotal} 笔` : ""}</Text>
        {trades.length === 0 ? (
          <Text className="dim">暂无交易记录</Text>
        ) : (
          trades.map((t) => (
            <View key={t.id} className="trade-row">
              <Text className={`t-dir ${t.direction === "buy" ? "dir-buy" : "dir-sell"}`}>
                {t.direction === "buy" ? "▲" : "▼"}
              </Text>
              <View className="t-mid">
                <Text className="t-sym">
                  {t.symbol} <Text className="dim">{Number(t.lots).toFixed(2)}手</Text>
                </Text>
                <Text className="dim">{bjDateTime(t.closeTime)} · 持仓 {t.holdMinutes} 分</Text>
              </View>
              <Text className={`t-pnl ${t.netProfit >= 0 ? "money-in" : "money-out"}`}>{usd(t.netProfit)}</Text>
            </View>
          ))
        )}
        {trades.length > 0 && trades.length < tradeTotal && (
          <Text className="dim more-tip">{loadingMore ? "加载中…" : "上拉加载更多"}</Text>
        )}
        {trades.length > 0 && trades.length >= tradeTotal && (
          <Text className="dim more-tip">—— 到底了 ——</Text>
        )}
      </View>
    </View>
  );
}
