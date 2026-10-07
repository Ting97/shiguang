/**
 * 收支复盘分包页 —— 与 web /finance/review 移动端逐块对齐（基准 apps/web/src/app/finance/review/page.tsx）。
 * 结构：hero → pill 二级导航 → 日/周切换 + 日期导航(‹ › 今) → 统计卡(支出/收入/笔数+环比) →
 * 周内日趋势双柱 → 支出分类(横条+行条) → 账户分布 + Top 对方 → AI 周报 → footer。
 * 统计零 AI 消耗；周报 GET 只读缓存、POST 才生成（走配额），错误（402/429/503…）直接展示服务端中文 message。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";
import { showToast } from "@/components/toast";
import { bjToday, fetchMe, yuan } from "@/lib/api";
import { TX_COLORS } from "@shiguangri/shared";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import { ApiError } from "@/lib/request";
import { getWeekReview, genWeekReview, loadStats, type WeekStats, type WeekReview } from "./api";
import "./index.scss";

/* ---------- 北京日历日工具（= web review/page.tsx 就地工具；UTC getter + 8h 防时区偏移） ---------- */

function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** 周一为周界；API 侧也用 bjMondayOf，锚点传任意日、range 由服务端归一 */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
/** ISO → 北京 M/D（生成时间展示；禁本地 getter，裸 toISOString 在东八区会切到前一天） */
function bjMD(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
/** 环比百分比：基期为 0 时显示 —（服务端 AI 摘要同口径） */
function momPct(cur: number, base: number): number | null {
  return base > 0 ? Math.round(((cur - base) / base) * 100) : null;
}
const fmt = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

/* ---------- 二级 pill 导航（与 pages/finance 同款，分包各自持有副本避免跨包依赖） ---------- */

const TABS = [
  { key: "finance", label: "📊 概览", path: "/pages/finance/index", module: null as string | null },
  { key: "debt", label: "🏦 负债", path: "/packages/debt/index/index", module: "debt" },
  { key: "review", label: "📈 收支复盘", path: "", module: "trade_review" },
  { key: "trading", label: "🎯 交易", path: "/packages/trading/index/index", module: "trading" },
];

export function FinTabs({ modules }: { modules: string[] | null }) {
  const has = (m: string) => modules?.includes(m) ?? false;
  return (
    <View className="fin-tabs">
      <View className="pill-nav">
        {TABS.filter((t) => !t.module || has(t.module)).map((t) => {
          const current = t.key === "review";
          return (
            <View
              key={t.key}
              className={`pill${current ? " pill-active" : ""}`}
              hoverClass={current ? "" : "press"}
              hoverStayTime={80}
              onTap={() => !current && Taro.redirectTo({ url: t.path })}
            >
              {t.label}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Chip({ icon, label, tone }: { icon: LucideIconName; label: string; tone: string }) {
  return (
    <View className={`chip chip-${tone}`}>
      {icon ? <LucideIcon name={icon} size={12} color="currentColor" /> : null}
      <Text>{label}</Text>
    </View>
  );
}

export function FinSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View className="fin-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="skeleton fin-skeleton-row" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </View>
  );
}

/* ---------- 模块未开通空态（= web module-locked.tsx） ---------- */

function ModuleLocked({ title, desc }: { title: string; desc: string }) {
  return (
    <View className="locked-card glass">
      <View className="locked-icon">
        <Text>🔒</Text>
      </View>
      <Text className="locked-title">{title}未开通</Text>
      <Text className="locked-desc">{desc}</Text>
      <View className="btn-sky-tinted locked-back" hoverClass="press" onTap={() => Taro.redirectTo({ url: "/pages/finance/index" })}>
        ← 返回财务概览
      </View>
    </View>
  );
}

/* ==================================================================== */

export default function ReviewPage() {
  const [locked, setLocked] = useState(false);
  const [modules, setModules] = useState<string[] | null>(null);
  // period=日/周；anchor=锚点日（默认北京今天），range 由 mondayOf 归一到周一~周日
  const [period, setPeriod] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(bjToday());
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [review, setReview] = useState<WeekReview | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; generatedAt?: string; range?: { from: string; to: string } } | null>(null);
  // 统计失败态：重试横幅；周报错误单独放 AI 卡内做徽标（统计挂了不应连带隐藏）
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [inited, setInited] = useState(false);
  // 取数序号：快速翻周/切日视图时旧响应可能后到，仅最新一次请求的响应可落地（对齐 web 复盘页 seq 范式）
  const statsSeq = useRef(0);
  const reviewSeq = useRef(0);

  const rangeFrom = period === "week" ? mondayOf(anchor) : anchor;

  /** 统计取数（403 → 锁定态；其余失败给重试） */
  async function loadStatsData(p = period, a = anchor) {
    const seq = ++statsSeq.current;
    setStatsErr(null);
    try {
      const s = await loadStats(p, a);
      if (seq !== statsSeq.current) return;
      setStats(s);
    } catch (e) {
      if (seq !== statsSeq.current) return;
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
        return;
      }
      setStats(null);
      setStatsErr(e instanceof Error ? e.message : String(e));
    }
  }

  /** 周报：refresh=false 只读缓存（不耗配额）；refresh=true 生成/刷新 */
  async function loadReview(refresh = false, p = period, a = anchor) {
    if (p !== "week") return;
    const seq = ++reviewSeq.current;
    const from = mondayOf(a);
    if (refresh) {
      setGenBusy(true);
      try {
        const j = await genWeekReview(from, true);
        if (seq !== reviewSeq.current) return;
        setReview(j.review ?? null);
        setMeta({ cached: !!j.cached, generatedAt: j.generatedAt, range: j.range });
      } catch (e) {
        if (seq !== reviewSeq.current) return;
        showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setGenBusy(false);
      }
      return;
    }
    try {
      const j = await getWeekReview(from);
      if (seq !== reviewSeq.current) return;
      if (j.review) {
        setReview(j.review);
        setMeta({ cached: true, generatedAt: j.generatedAt, range: j.range });
      } else {
        setReview(null);
        setMeta(null);
      }
    } catch (e) {
      if (seq !== reviewSeq.current) return;
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
        return;
      }
      // 缓存读取失败不阻塞统计区
      setReview(null);
      setMeta(null);
    }
  }

  /** 切周期/锚点：重拉统计 + 清掉旧周报再读缓存（= web 两个 useEffect 的合并触发） */
  function changeView(p = period, a = anchor) {
    setReview(null);
    setMeta(null);
    void loadStatsData(p, a);
    void loadReview(false, p, a);
  }

  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken()) return;
    setInited(true);
    changeView();
    fetchMe()
      .then((j) => setModules(j.modules ?? []))
      .catch(() => setModules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    Promise.all([loadStatsData(), loadReview(false)]).finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell active="finance">
        <GuestGate title="交易复盘" desc="交易统计、权益曲线与 AI 归因复盘" />
      </PageShell>
    );
  }

  const hasModule = modules?.includes("trade_review") ?? false;

  /** 切日/周（web：切 period 后两个 useEffect 自动重拉） */
  function switchPeriod(p: "day" | "week") {
    if (p === period) return;
    setPeriod(p);
    changeView(p, anchor);
  }
  /** ‹ › 翻日/周；「今」回当天 */
  function shiftAnchor(delta: number) {
    const next = addDays(anchor, period === "day" ? delta : delta * 7);
    setAnchor(next);
    changeView(period, next);
  }
  function goToday() {
    setAnchor(bjToday());
    changeView(period, bjToday());
  }

  /* ---- 派生数据（与 web 同公式） ---- */
  const outMom = stats ? momPct(stats.totals.outCents, stats.prev.outCents) : null;
  const inMom = stats ? momPct(stats.totals.inCents, stats.prev.inCents) : null;
  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => Math.max(d.outCents, d.inCents))) : 1;
  const rangeLabel =
    period === "day"
      ? anchor
      : `${Number(rangeFrom.slice(5, 7))}/${Number(rangeFrom.slice(8, 10))} ~ ${Number(addDays(rangeFrom, 6).slice(5, 7))}/${Number(addDays(rangeFrom, 6).slice(8, 10))}`;
  // 仅当缓存的 range 与当前视图一致才展示（= web reviewForThisWeek 防翻周后串台）
  const reviewForThisWeek = review && meta && meta.range?.from === rangeFrom ? review : null;
  const nextDisabled = period === "day" ? anchor >= bjToday() : mondayOf(anchor) >= mondayOf(bjToday());

  /* ---- 锁定态：与 web locked 分支一致，只渲染 ModuleLocked 卡 ---- */
  if (locked || (modules !== null && !hasModule)) {
    return (
      <PageShell active="finance">
        <ModuleLocked title="收支复盘" desc="该模块由管理员授权后开放，可联系管理员开通。" />
      </PageShell>
    );
  }

  return (
    <PageShell active="finance">
      <View className="fin-hero">
        <View className="fin-hero-line">
          <Text className="hero text-gradient">拾光</Text>
          <Text className="fin-hero-sub">收支复盘</Text>
        </View>
        <Text className="fin-hero-tip">日/周收支结构与 AI 周报 —— 花在哪、怎么调</Text>
      </View>

      <FinTabs modules={modules} />

      {/* 日/周切换 + 日期导航（= web mb-4 flex justify-between） */}
      <View className="rev-toolbar">
        <View className="pill-nav">
          <View className={`pill${period === "day" ? " pill-active" : ""}`} hoverClass="press" onTap={() => switchPeriod("day")}>
            日
          </View>
          <View className={`pill${period === "week" ? " pill-active" : ""}`} hoverClass="press" onTap={() => switchPeriod("week")}>
            周
          </View>
        </View>
        <View className="rev-datenav">
          <View className="nav-btn" hoverClass="press" onTap={() => shiftAnchor(-1)}>
            ‹
          </View>
          <Text className="rev-range tabular">{rangeLabel}</Text>
          <View className={`nav-btn ${nextDisabled ? "nav-btn-disabled" : ""}`} hoverClass="press" onTap={() => !nextDisabled && shiftAnchor(1)}>
            ›
          </View>
          <View className="rev-today" hoverClass="press" onTap={goToday}>
            今
          </View>
        </View>
      </View>


      {!stats ? (
        statsErr ? (
          <View className="loadfail">
            <Text className="loadfail-text">加载失败：{statsErr}</Text>
            <Button
              className="btn-primary loadfail-btn"
              hoverClass="press"
              onClick={() => {
                setLocked(false);
                void loadStatsData();
              }}
            >
              重试
            </Button>
          </View>
        ) : (
          <FinSkeleton rows={3} />
        )
      ) : (
        <>
          {/* 统计卡（= glass rounded-2xl p-5 grid-cols-3） */}
          <View className="glass glass-p5 rev-card">
            <View className="ov-grid3">
              <View className="ov-cell">
                <Text className="ov-label">{period === "day" ? "当日支出" : "本周支出"}</Text>
                <Text className="ov-num money-out">{fmt(stats.totals.outCents)}</Text>
                {outMom != null && (
                  <Text className={`ov-sub tabular ${outMom > 0 ? "money-out" : "money-in"}`}>
                    环比 {outMom > 0 ? "+" : ""}
                    {outMom}%
                  </Text>
                )}
              </View>
              <View className="ov-cell">
                <Text className="ov-label">{period === "day" ? "当日收入" : "本周收入"}</Text>
                <Text className="ov-num money-in">{fmt(stats.totals.inCents)}</Text>
                {inMom != null && (
                  <Text className={`ov-sub tabular ${inMom > 0 ? "money-in" : "money-out"}`}>
                    环比 {inMom > 0 ? "+" : ""}
                    {inMom}%
                  </Text>
                )}
              </View>
              <View className="ov-cell">
                <Text className="ov-label">笔数</Text>
                <Text className="ov-num">{stats.totals.count}</Text>
                <Text className="ov-sub hint-faint">
                  结余 <Text className={stats.totals.inCents - stats.totals.outCents >= 0 ? "money-in" : "money-out"}>{fmt(stats.totals.inCents - stats.totals.outCents)}</Text>
                </Text>
              </View>
            </View>
          </View>

          {/* 周内日趋势：支出红/收入绿双柱（缺失日补零，服务端 daily 恒 7 天） */}
          {period === "week" && stats.daily.length > 0 && (
            <View className="glass glass-p5 rev-card">
              <View className="rev-card-head">
                <Chip icon="bar_chart_3" label="日趋势" tone="sky" />
              </View>
              <View className="dtrend">
                {stats.daily.map((d) => (
                  <View key={d.date} className="dtrend-col">
                    <View className="dtrend-bars">
                      <View
                        className="dt-bar dt-bar-out"
                        style={{ height: d.outCents > 0 ? `${Math.max(6, Math.round((d.outCents / maxDaily) * 128))}px` : "4px" }}
                      />
                      <View
                        className="dt-bar dt-bar-in"
                        style={{ height: d.inCents > 0 ? `${Math.max(6, Math.round((d.inCents / maxDaily) * 128))}px` : "4px" }}
                      />
                    </View>
                    <Text className="hint-faint dtrend-day">{Number(d.date.slice(8))}</Text>
                  </View>
                ))}
              </View>
              <Text className="dtrend-legend">
                <Text className="money-out">▮</Text> 支出 <Text className="money-in">▮</Text> 收入
              </Text>
            </View>
          )}

          {/* 支出分类：占比横条 + 行条列表 */}
          {stats.byCategory.length > 0 && (
            <View className="glass glass-p5 rev-card">
              <View className="rev-card-head">
                <Chip icon="clipboard_list" label="支出分类" tone="rose" />
              </View>
              <View className="cat-bar">
                {stats.byCategory.map((s) => (
                  <View key={s.category} className="cat-bar-seg" style={{ width: `${s.pct}%`, backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                ))}
              </View>
              <View className="rev-cats">
                {stats.byCategory.map((s) => (
                  <View key={s.category} className="rev-cat-row">
                    <Text className="rev-cat-name">{s.category}</Text>
                    <View className="rev-cat-track">
                      <View className="rev-cat-bar" style={{ width: `${s.pct}%` }} />
                    </View>
                    <Text className="rev-cat-amt">{fmt(s.cents)}</Text>
                    <Text className="hint-faint rev-cat-pct">{s.pct}%</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 账户分布 + Top 对方（手机单列堆叠） */}
          {(stats.byAccount.length > 0 || stats.topCounterparties.length > 0) && (
            <View className="rev-pair">
              {stats.byAccount.length > 0 && (
                <View className="glass glass-p5 rev-card rev-pair-card">
                  <View className="rev-card-head">
                    <Chip icon="credit_card" label="账户分布" tone="sky" />
                  </View>
                  {stats.byAccount.map((a) => (
                    <View key={a.name} className="rev-line">
                      <Text>{a.icon}</Text>
                      <Text className="rev-line-name">{a.name}</Text>
                      <Text className="tabular money-out">{a.outCents > 0 ? `-${fmt(a.outCents)}` : ""}</Text>
                      {a.inCents > 0 && <Text className="tabular money-in">+{fmt(a.inCents)}</Text>}
                    </View>
                  ))}
                </View>
              )}
              {stats.topCounterparties.length > 0 && (
                <View className="glass glass-p5 rev-card rev-pair-card">
                  <View className="rev-card-head">
                    <Chip icon="users" label="Top 对方" tone="violet" />
                  </View>
                  {stats.topCounterparties.map((p) => (
                    <View key={p.name} className="rev-line">
                      <Text className="rev-line-name">{p.name}</Text>
                      <Text className="hint-faint">{p.count} 笔</Text>
                      <Text className="tabular money-out">{fmt(p.outCents)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* AI 周报卡（仅周视图；= web emerald tinted 生成钮） */}
          {period === "week" && (
            <View className="glass glass-p5 rev-card">
              <View className="ai-head">
                <View className="ai-head-l">
                  <Chip icon="sparkles" label="AI 交易周报" tone="emerald" />
                  {meta && reviewForThisWeek && (
                    <Text className="hint-faint">
                      {meta.cached ? "缓存" : "已生成"} · {bjMD(meta.generatedAt ?? "")}
                    </Text>
                  )}
                </View>
                <Button
                  className={`ai-gen-btn ${genBusy ? "disabled" : ""}`}
                  disabled={genBusy}
                  hoverClass="press"
                  onClick={() => void loadReview(true)}
                >
                  {genBusy ? "生成中…" : reviewForThisWeek ? "重新生成" : "生成周报"}
                </Button>
              </View>
              {genBusy && !reviewForThisWeek && <Text className="rev-ai-busy">正在读取本周流水并生成解读…</Text>}
              {reviewForThisWeek ? (
                <View className="rev-ai-body">
                  <Text className="rev-ai-summary">{reviewForThisWeek.summary}</Text>
                  {reviewForThisWeek.highlights.length > 0 && (
                    <View className="rev-ai-list">
                      {reviewForThisWeek.highlights.map((h, i) => (
                        <Text key={i} className="rev-ai-line">
                          <Text className="money-in">◆</Text>
                          {h}
                        </Text>
                      ))}
                    </View>
                  )}
                  {reviewForThisWeek.suggestions.length > 0 && (
                    <View className="rev-ai-list rev-ai-sug">
                      {reviewForThisWeek.suggestions.map((s, i) => (
                        <Text key={i} className="rev-ai-line dim-soft">
                          <Text className="rev-ai-mark">✦</Text>
                          {s}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                !genBusy && <Text className="rev-ai-empty">点「生成周报」让 AI 解读本周收支（走 AI 配额，结果缓存）</Text>
              )}
            </View>
          )}

          <Text className="fin-footer">拾光 · 收支复盘 · 统计零 AI 消耗，周报走 AI 配额</Text>
        </>
      )}
    </PageShell>
  );
}
