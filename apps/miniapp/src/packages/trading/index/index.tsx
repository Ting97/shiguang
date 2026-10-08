/**
 * 交易分包页 —— 与 web /finance/trading 移动端逐块对齐（基准 apps/web/src/app/finance/trading/*）。
 * 结构：hero → pill 二级导航 → 账号卡(chips + 一键同步 + 汇总五项) → 每日/每周盈亏(折线+清单) →
 * 权益曲线(峰值/回撤) → 逐笔明细(归类 chips + 分页) → 统计卡(digest) → AI 复盘(降级徽标) → footer。
 * 与 web 的差异（小程序约束）：
 * - 无 SVG：折线用「旋转线段 View」手绘（每段一个绝对定位 View），面积渐变填充从简省略；
 *   web 的 title 悬浮提示改为「点柱看明细」行；
 * - 「⚙ 绑定 Bitget API」抽屉表单重（密钥三元组），小程序仅提示走 web 端；「⚡一键同步」完整实现
 *   （web 移动端也开放，纯 API 调用无文件依赖）；「📥导入报表」web 本就仅 PC 渲染（FR-1.8），不渲染。
 * 金额口径：USD 原币数值（非分），展示用 fmtUsd()，禁用 yuan()。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Button, Picker, ScrollView } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";
import { fetchMe } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import { ApiError } from "@/lib/request";
import {
  BUCKET_LABEL,
  addDays,
  bjDate,
  bjMonthRange,
  bjTime,
  bjTodayStr,
  fmtHold,
  fmtUsd,
  genReview,
  getReviewCache,
  groupByWeek,
  loadAccounts,
  loadBitgetKeys,
  loadDaily,
  loadDigest,
  loadEquity,
  loadTrades,
  pnlTone,
  syncBitget,
  type DailyDay,
  type Digest,
  type TradingAccount,
  type TradingReviewBody,
  type WeekDay,
} from "./api";
import "./index.scss";

/* ---------- 二级 pill 导航（与 pages/finance 同款，分包各自持有副本避免跨包依赖） ---------- */

const TABS = [
  { key: "finance", label: "📊 概览", path: "/pages/finance/index", module: null as string | null },
  { key: "debt", label: "🏦 负债", path: "/packages/debt/index/index", module: "debt" },
  { key: "review", label: "📈 收支复盘", path: "/packages/review/index/index", module: "trade_review" },
  { key: "trading", label: "🎯 交易", path: "", module: "trading" },
];

export function FinTabs({ modules }: { modules: string[] | null }) {
  const has = (m: string) => modules?.includes(m) ?? false;
  return (
    <View className="fin-tabs">
      <View className="pill-nav">
        {TABS.filter((t) => !t.module || has(t.module)).map((t) => {
          const current = t.key === "trading";
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

export function FinSkeleton({ rows = 4 }: { rows?: number }) {
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

/* ---------- 折线图手绘工具（无 SVG 替代） ---------- */

/** 设计单位 → 屏幕 px 换算系数（designWidth 750） */
function unitK(): number {
  try {
    return Taro.getWindowInfo().windowWidth / 750;
  } catch {
    return 0.5;
  }
}

/** 测容器宽（px）：折线以旋转线段绝对定位，必须知道真实渲染宽度 */
function useChartWidth(cls: string, dep: unknown): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => {
      Taro.createSelectorQuery()
        .select(cls)
        .boundingClientRect()
        .exec((res) => {
          const r = res[0] as { width: number } | undefined;
          if (r?.width) setW(r.width);
        });
    }, 60); // 等一拍布局完成再量，避免量到 0
    return () => clearTimeout(id);
  }, [dep, cls]);
  return w;
}

interface Seg {
  x: number;
  y: number;
  len: number;
  angle: number;
}
/** 两点 → 旋转线段定位参数（px） */
function segOf(x1: number, y1: number, x2: number, y2: number): Seg {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return { x: x1, y: y1, len: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/* ---------- 每日/每周盈亏（= web daily-section.tsx） ---------- */

function DailySection({ accountId }: { accountId: string }) {
  const [days, setDays] = useState<DailyDay[] | null>(null);
  const [mode, setMode] = useState<"day" | "week">("day");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  // 筛选：空 = 默认（日视图近 30 个「有交易」交易日；周视图近 100 天）
  const [fromSel, setFromSel] = useState("");
  const [toSel, setToSel] = useState("");
  const [selIdx, setSelIdx] = useState<number | null>(null); // 点柱看明细（= web hover title）

  useEffect(() => {
    let live = true;
    setDays(null);
    setLoadErr(null);
    setSelIdx(null);
    const to = toSel || bjTodayStr();
    const from = fromSel || addDays(to, -100); // 默认多取窗口，日视图切片出近 30 个交易日
    loadDaily(accountId, from, to)
      .then((j) => {
        if (!live) return;
        if (fromSel || toSel) setDays(j.days); // 自定义筛选：完整呈现所选范围
        else setDays(j.days.slice(-30));
      })
      .catch((e) => {
        if (live) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [accountId, rev, fromSel, toSel]);

  const weeks: WeekDay[] = days ? groupByWeek(days) : [];
  const view: (DailyDay | WeekDay)[] = mode === "week" ? weeks : days ?? [];
  const isWeek = (d: DailyDay | WeekDay): d is WeekDay => mode === "week";
  const maxAbs = Math.max(1, ...view.map((d) => Math.abs(d.net)));
  const [curFrom, curTo] = bjMonthRange(0);
  const [prevFrom, prevTo] = bjMonthRange(-1);
  const filtered = fromSel !== "" || toSel !== "";

  const chartW = useChartWidth(".pnl-chart", `${accountId}-${rev}-${view.length}-${mode}`);
  const k = unitK();
  const H = 192 * k; // = web h-24（96px×2 单位）
  const zeroY = H / 2;
  // 净盈亏 → px Y：[-maxAbs, +maxAbs] 映射到 [H, 0]（零轴居中，留 4u 边距）
  const xAt = (i: number) => ((i + 0.5) * chartW) / Math.max(1, view.length);
  const yAt = (net: number) => zeroY - (net / maxAbs) * (zeroY - 4 * k);
  const segs: Seg[] = [];
  for (let i = 0; i + 1 < view.length; i++) segs.push(segOf(xAt(i), yAt(view[i].net), xAt(i + 1), yAt(view[i + 1].net)));

  const labelOf = (d: DailyDay | WeekDay) =>
    isWeek(d) ? `${d.weekStart.slice(5).replace("-", "/")}~${d.weekEnd.slice(5).replace("-", "/")}` : d.ymd;
  const xLabel = (d: DailyDay | WeekDay, i: number) => {
    const cur = i === view.length - 1;
    if (!cur && i % 5 !== 0) return "";
    return isWeek(d)
      ? String(Number(d.weekStart.slice(5, 7)))
      : `${Number(d.ymd.slice(5, 7))}/${Number(d.ymd.slice(8, 10))}`;
  };

  return (
    <View className="glass glass-p5 trade-card">
      <View className="sec-head">
        <Chip icon="calendar" label={mode === "week" ? "每周盈亏" : "每日盈亏"} tone="sky" />
        <Text className="sec-sub">{filtered ? `${fromSel || "…"} ~ ${toSel || "今天"}` : "按北京时区切日"}</Text>
        {/* 日/周分段（= web ml-auto 分段钮：选中 sky/15 底 + sky 字） */}
        <View className="seg">
          <View className={`seg-btn ${mode === "day" ? "seg-on" : ""}`} onTap={() => setMode("day")}>
            日
          </View>
          <View className={`seg-btn ${mode === "week" ? "seg-on" : ""}`} onTap={() => setMode("week")}>
            周
          </View>
        </View>
      </View>

      {/* 时间筛选：快捷段 + 自定义起止（start==end 即看某一天） */}
      <View className="tfilter-row">
        <View
          className={`tf-chip ${!filtered ? "tf-chip-on" : ""}`}
          onTap={() => {
            setFromSel("");
            setToSel("");
          }}
        >
          近 30 天
        </View>
        <View
          className={`tf-chip ${filtered && fromSel === curFrom ? "tf-chip-on" : ""}`}
          onTap={() => {
            setFromSel(curFrom);
            setToSel(curTo > bjTodayStr() ? bjTodayStr() : curTo);
          }}
        >
          本月
        </View>
        <View
          className={`tf-chip ${filtered && fromSel === prevFrom ? "tf-chip-on" : ""}`}
          onTap={() => {
            setFromSel(prevFrom);
            setToSel(prevTo);
          }}
        >
          上月
        </View>
        <View className="tf-dates">
          <Picker mode="date" value={fromSel || bjTodayStr()} onChange={(e) => setFromSel(e.detail.value)}>
            <View className="tf-date">
              <Text>{fromSel || "开始"}</Text>
            </View>
          </Picker>
          <Text className="hint-faint">~</Text>
          <Picker mode="date" value={toSel || bjTodayStr()} onChange={(e) => setToSel(e.detail.value)}>
            <View className="tf-date">
              <Text>{toSel || "结束"}</Text>
            </View>
          </Picker>
        </View>
      </View>

      {!days ? (
        loadErr ? (
          <View className="sec-loadfail">
            <Text className="sec-loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary sec-retry" hoverClass="press" onClick={() => setRev((r) => r + 1)}>
              重试
            </Button>
          </View>
        ) : (
          <View className="fin-skeleton">
            <View className="skeleton fin-skeleton-row" />
            <View className="skeleton fin-skeleton-row" style={{ opacity: 0.82 }} />
          </View>
        )
      ) : days.length === 0 ? (
        <Text className="sec-empty">暂无平仓记录</Text>
      ) : (
        <>
          {/* 折线：旋转线段手绘（= web SVG polyline + 渐变面积；面积填充从简省略） */}
          <View className="pnl-chart" style={{ height: `${H}px` }}>
            {/* 零轴 */}
            <View className="pnl-zero" style={{ top: `${zeroY}px` }} />
            {chartW > 0 && segs.map((s, i) => (
              <View
                key={i}
                className="pnl-seg"
                style={{
                  left: `${s.x}px`,
                  top: `${s.y - 1.5}px`,
                  width: `${s.len}px`,
                  transform: `rotate(${s.angle}deg)`,
                }}
              />
            ))}
            {/* 点柱覆层：替代 web hover 提示，点击查看该日明细；最后一列常亮高亮（= web isCur ring） */}
            <View className="pnl-cols">
              {view.map((d, i) => (
                <View
                  key={isWeek(d) ? d.weekStart : (d as DailyDay).ymd}
                  className={`pnl-col${i === view.length - 1 ? " pnl-col-cur" : ""}${i === selIdx ? " pnl-col-on" : ""}`}
                  onTap={() => setSelIdx(i === selIdx ? null : i)}
                />
              ))}
            </View>
          </View>
          {/* 点选明细行（= web title tooltip 内容） */}
          {selIdx != null && view[selIdx] && (
            <Text className="pnl-tip">
              {labelOf(view[selIdx])}：{view[selIdx].count} 笔 · {view[selIdx].lots.toFixed(2)} 手 · 净 {fmtUsd(view[selIdx].net)}
              {!isWeek(view[selIdx]) && (view[selIdx] as DailyDay).prevNet != null
                ? `（前一日 ${fmtUsd((view[selIdx] as DailyDay).prevNet!)}）`
                : ""}
            </Text>
          )}
          {/* X 轴标签（每 5 个 + 最后一个） */}
          <View className="pnl-xlabels">
            {view.map((d, i) => (
              <Text key={`x-${isWeek(d) ? d.weekStart : (d as DailyDay).ymd}`} className="pnl-xlabel">
                {xLabel(d, i)}
              </Text>
            ))}
          </View>
          <Text className="chart-caption">
            <Text className="chart-sky">━</Text> 净盈亏走势（虚线中轴为 0）· 点柱看每日明细
          </Text>

          {/* 明细表：横向滚动防溢出（= web overflow-x-auto 固定列宽） */}
          <ScrollView className="tbl-scroll" scrollX enhanced showScrollbar={false}>
            <View className="tbl">
              <View className="tbl-head">
                <Text className="tw-80">日期</Text>
                <Text className="tw-40">笔数</Text>
                <Text className="tw-64">手数</Text>
                {mode === "day" ? (
                  <>
                    <Text className="tw-40">胜率</Text>
                    <Text className="tw-64">连赢/亏</Text>
                  </>
                ) : (
                  <Text className="tw-112">盈利天/交易天</Text>
                )}
                <Text className="tw-flex">净盈亏</Text>
              </View>
              {[...view].reverse().map((d) =>
                isWeek(d) ? (
                  <View
                    key={d.weekStart}
                    className="tbl-row"
                    onTap={() => {
                      // 点周行 → 聚焦该周（= web onClick 设筛选）
                      setFromSel(d.weekStart);
                      setToSel(d.weekEnd > bjTodayStr() ? bjTodayStr() : d.weekEnd);
                    }}
                  >
                    <Text className="tw-80 t-strong">
                      {d.weekStart.slice(5).replace("-", "/")}~{d.weekEnd.slice(8)}
                    </Text>
                    <Text className="tw-40 t-mute">{d.count}</Text>
                    <Text className="tw-64 t-mute">{d.lots.toFixed(2)}</Text>
                    <Text className="tw-112 t-dim">
                      {d.upDays}/{d.days}
                    </Text>
                    <Text className={`tw-flex t-strong ${pnlTone(d.net)}`}>{fmtUsd(d.net)}</Text>
                  </View>
                ) : (
                  <View key={(d as DailyDay).ymd} className="tbl-row">
                    <Text className="tw-80 t-strong">{(d as DailyDay).ymd.slice(5).replace("-", "/")}</Text>
                    <Text className="tw-40 t-mute">{d.count}</Text>
                    <Text className="tw-64 t-mute">{d.lots.toFixed(2)}</Text>
                    <Text className="tw-40 t-dim">{(d as DailyDay).winRate != null ? `${(d as DailyDay).winRate}%` : "—"}</Text>
                    <Text className="tw-64">
                      {(d as DailyDay).streak > 0 && <Text className="streak streak-up">连赢{(d as DailyDay).streak}</Text>}
                      {(d as DailyDay).streak < 0 && <Text className="streak streak-down">连亏{-(d as DailyDay).streak}</Text>}
                      {(d as DailyDay).streak === 0 && <Text className="hint-faint">—</Text>}
                    </Text>
                    <Text className={`tw-flex t-strong ${pnlTone(d.net)}`}>{fmtUsd(d.net)}</Text>
                  </View>
                ),
              )}
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

/* ---------- 权益曲线（= web equity-section.tsx；含峰值/回撤） ---------- */

function EquitySection({ accountId }: { accountId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadEquity>> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setLoadErr(null);
    loadEquity(accountId)
      .then((j) => {
        if (live) setData(j);
      })
      .catch((e) => {
        if (live) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [accountId, rev]);

  const pts = data?.points ?? [];
  const n = pts.length;
  const vals = pts.map((p) => p.cum);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const chartW = useChartWidth(".eq-chart", `${accountId}-${rev}-${n}`);
  const k = unitK();
  const H = 256 * k; // = web h-32（128px×2）
  const pad = 10 * k;
  const xAt = (i: number) => pad + (i * (chartW - 2 * pad)) / Math.max(1, n - 1);
  const yAt = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const segs: Seg[] = [];
  for (let i = 0; i + 1 < n; i++) segs.push(segOf(xAt(i), yAt(pts[i].cum), xAt(i + 1), yAt(pts[i + 1].cum)));
  // 回撤段单独描红（服务端已算好 start→trough）
  const ymIdx = new Map(pts.map((p, i) => [p.ymd, i]));
  const ddSegs = (data?.drawdowns ?? [])
    .map((dd) => {
      const a = ymIdx.get(dd.startYmd);
      const b = ymIdx.get(dd.troughYmd);
      if (a == null || b == null || b <= a) return null;
      const segs2: Seg[] = [];
      for (let i = a; i < b; i++) segs2.push(segOf(xAt(i), yAt(pts[i].cum), xAt(i + 1), yAt(pts[i + 1].cum)));
      return segs2;
    })
    .filter(Boolean) as Seg[][];
  const peakIdx = data?.peak ? ymIdx.get(data.peak.ymd) : undefined;
  const maxDd = data?.drawdowns[0];

  return (
    <View className="glass glass-p5 trade-card">
      <View className="sec-head">
        <Chip icon="trending_up" label="权益曲线 · 累计净盈亏" tone="emerald" />
        <Text className="sec-sub">日粒度 · 峰值与回撤服务端预计算</Text>
      </View>
      {!data ? (
        loadErr ? (
          <View className="sec-loadfail">
            <Text className="sec-loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary sec-retry" hoverClass="press" onClick={() => setRev((r) => r + 1)}>
              重试
            </Button>
          </View>
        ) : (
          <View className="fin-skeleton">
            <View className="skeleton fin-skeleton-row" />
            <View className="skeleton fin-skeleton-row" style={{ opacity: 0.82 }} />
          </View>
        )
      ) : n === 0 ? (
        <Text className="sec-empty">暂无平仓记录</Text>
      ) : (
        <>
          <View className="eq-chart" style={{ height: `${H}px` }}>
            {/* 零轴虚线（跨零时显示） */}
            {min < 0 && max > 0 && <View className="eq-zero" style={{ top: `${yAt(0)}px` }} />}
            {chartW > 0 && (
              <>
                {segs.map((s, i) => (
                  <View
                    key={`m${i}`}
                    className="eq-seg"
                    style={{ left: `${s.x}px`, top: `${s.y - 1.5}px`, width: `${s.len}px`, transform: `rotate(${s.angle}deg)` }}
                  />
                ))}
                {ddSegs.map((segs2, kk) =>
                  segs2.map((s, i) => (
                    <View
                      key={`d${kk}-${i}`}
                      className="eq-seg-dd"
                      style={{ left: `${s.x}px`, top: `${s.y - 2}px`, width: `${s.len}px`, transform: `rotate(${s.angle}deg)` }}
                    />
                  )),
                )}
              </>
            )}
            {/* 峰值点（HTML 覆层，避免随线段形变） */}
            {peakIdx != null && data?.peak && chartW > 0 && (
              <View className="eq-peak" style={{ left: `${xAt(peakIdx)}px`, top: `${yAt(data.peak.cum)}px` }} />
            )}
          </View>
          <Text className="chart-caption">
            <Text className="chart-sky">━</Text> 累计净盈亏 <Text className="money-out">━</Text> 回撤段{" "}
            <Text className="chart-sky">●</Text> 峰值
          </Text>

          <View className="eq-stats">
            <View className="eq-stat">
              <Text className="ov-label">累计净盈亏</Text>
              <Text className={`eq-stat-num ${pnlTone(data.totalNet)}`}>{fmtUsd(data.totalNet)}</Text>
            </View>
            <View className="eq-stat">
              <Text className="ov-label">权益峰值</Text>
              <Text className="eq-stat-num">{data.peak ? fmtUsd(data.peak.cum) : "—"}</Text>
              <Text className="eq-stat-sub">{data.peak?.ymd ?? "—"}</Text>
            </View>
            <View className="eq-stat">
              <Text className="ov-label">最大回撤</Text>
              <Text className="eq-stat-num money-out">{maxDd ? `-${fmtUsd(maxDd.amount)}` : "—"}</Text>
              <Text className="eq-stat-sub">{maxDd ? `${maxDd.startYmd} → ${maxDd.troughYmd}` : "无回撤"}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

/* ---------- 逐笔明细（= web trades-section.tsx：归类 chips + 分页表） ---------- */

const GROUPS: { key: "dir" | "period" | "durBand" | "pnlBand"; label: string; options: { v: string; label: string }[] }[] = [
  {
    key: "dir",
    label: "方向",
    options: [
      { v: "", label: "全部" },
      { v: "buy", label: "买入" },
      { v: "sell", label: "卖出" },
    ],
  },
  {
    key: "period",
    label: "时段",
    options: [
      { v: "", label: "全部" },
      { v: "morning", label: "早" },
      { v: "afternoon", label: "午" },
      { v: "evening", label: "晚" },
      { v: "lateNight", label: "深夜" },
    ],
  },
  {
    key: "durBand",
    label: "时长",
    options: [
      { v: "", label: "全部" },
      { v: "lt15m", label: "<15分" },
      { v: "m15to60", label: "15-60分" },
      { v: "h1to4", label: "1-4时" },
      { v: "gt4h", label: ">4时" },
    ],
  },
  {
    key: "pnlBand",
    label: "盈亏",
    options: [
      { v: "", label: "全部" },
      { v: "win", label: "赢" },
      { v: "loss", label: "亏" },
      { v: "bigWin", label: "大赢" },
      { v: "bigLoss", label: "大亏" },
    ],
  },
];

function TradesSection({ accountId }: { accountId: string }) {
  const [filters, setFilters] = useState({ dir: "", period: "", durBand: "", pnlBand: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadTrades>> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // seq 守卫：筛选/翻页快速切换时慢的旧响应可能后到，只让最新请求落地
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setBusy(true);
    setLoadErr(null);
    try {
      const j = await loadTrades(accountId, filters, page);
      if (seq !== loadSeq.current) return;
      setData(j);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setData(null);
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, [accountId, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (key: keyof typeof filters, v: string) => {
    setFilters((f) => (f[key] === v ? f : { ...f, [key]: v }));
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <View className="glass glass-p5 trade-card">
      <View className="sec-head">
        <Chip icon="list_todo" label="逐笔明细" tone="violet" />
        {data && <Text className="sec-sub">共 {data.total} 笔</Text>}
      </View>

      {/* 归类筛选（与服务端 SQL 分桶一致；= FilterChip variant=filter） */}
      <View className="grp-rows">
        {GROUPS.map((g) => (
          <View key={g.key} className="grp-row">
            <Text className="grp-label">{g.label}</Text>
            <View className="grp-chips">
              {g.options.map((o) => (
                <View key={o.v} className={`tf-chip ${filters[g.key] === o.v ? "tf-chip-on" : ""}`} onTap={() => pick(g.key, o.v)}>
                  {o.label}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {!data ? (
        loadErr ? (
          <View className="sec-loadfail">
            <Text className="sec-loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary sec-retry" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          <View className="fin-skeleton">
            <View className="skeleton fin-skeleton-row" />
            <View className="skeleton fin-skeleton-row" style={{ opacity: 0.82 }} />
            <View className="skeleton fin-skeleton-row" style={{ opacity: 0.64 }} />
          </View>
        )
      ) : data.items.length === 0 ? (
        <Text className="sec-empty">该筛选条件下没有成交记录</Text>
      ) : (
        <>
          <ScrollView className="tbl-scroll" scrollX enhanced showScrollbar={false}>
            <View className="tbl">
              <View className="tbl-head">
                <Text className="tw-56">方向</Text>
                <Text className="tw-80">品种 · 手数</Text>
                <Text className="tw-flex">开仓 → 平仓（北京）</Text>
                <Text className="tw-112">时长</Text>
                <Text className="tw-160">净盈亏</Text>
              </View>
              {data.items.map((t) => (
                <View key={t.id} className="tbl-row">
                  <Text className={`tw-56 t-dir ${t.direction === "buy" ? "t-dir-buy" : "t-dir-sell"}`}>{t.direction === "buy" ? "买" : "卖"}</Text>
                  <Text className="tw-80 t-sym">
                    {t.symbol}
                    <Text className="hint-faint"> {t.lots}</Text>
                  </Text>
                  <Text className="tw-flex t-dim">
                    {bjTime(t.openTime)} → {bjTime(t.closeTime)}
                  </Text>
                  <Text className="tw-112 t-dim">{fmtHold(t.holdMinutes)}</Text>
                  <Text className={`tw-160 t-strong ${pnlTone(t.netProfit)}`}>{fmtUsd(t.netProfit)}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View className="pager">
            <View
              className={`pager-btn ${page <= 1 || busy ? "pager-disabled" : ""}`}
              hoverClass="press"
              onTap={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← 上一页
            </View>
            <Text className="hint-faint tabular">
              第 {data.page} / {totalPages} 页{busy ? " · 加载中…" : ""}
            </Text>
            <View
              className={`pager-btn ${page >= totalPages || busy ? "pager-disabled" : ""}`}
              hoverClass="press"
              onTap={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页 →
            </View>
          </View>
        </>
      )}
    </View>
  );
}

/* ---------- 统计 + AI 复盘（= web digest-section.tsx） ---------- */

/** 归类分布小节：bucket 行 + 净盈亏横条 */
function AggList({ title, rows }: { title: string; rows: Digest["aggregations"]["byPeriod"] }) {
  if (!rows.length) return null;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return (
    <View className="agg">
      <Text className="agg-title">{title}</Text>
      {rows.map((r) => (
        <View key={r.bucket} className="agg-row">
          <Text className="agg-name">{BUCKET_LABEL[r.bucket] ?? r.bucket}</Text>
          <View className="agg-track">
            <View
              className={`agg-bar ${r.net >= 0 ? "agg-bar-up" : "agg-bar-down"}`}
              style={{ width: `${(Math.abs(r.net) / maxAbs) * 100}%` }}
            />
          </View>
          <Text className="agg-count">{r.count}笔</Text>
          <Text className={`agg-net ${pnlTone(r.net)}`}>{fmtUsd(r.net)}</Text>
        </View>
      ))}
    </View>
  );
}

function DigestSection({ accountId }: { accountId: string }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestErr, setDigestErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  // AI 复盘三态：ai=LLM 版（缓存秒显）/ fallback=规则版 digest +「已降级」徽标 / null=未生成
  const [review, setReview] = useState<{ kind: "ai"; review: TradingReviewBody; cached: boolean; generatedAt: string } | { kind: "fallback"; reason: string; digest: Digest | null } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDigest(null);
    setReview(null);
    setError(null);
    setDigestErr(null);
    loadDigest(accountId)
      .then((j) => {
        if (live) setDigest(j);
      })
      .catch((e) => {
        if (live) setDigestErr(e instanceof Error ? e.message : String(e));
      });
    // 只读缓存（GET 不耗配额），缓存命中秒显
    getReviewCache(accountId)
      .then((j) => {
        if (live && j.review) setReview({ kind: "ai", review: j.review, cached: true, generatedAt: j.generatedAt ?? "" });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, rev]);

  const generate = useCallback(async () => {
    setGenBusy(true);
    setError(null);
    try {
      const j = await genReview(accountId, true);
      if (j.fallback) {
        setReview({ kind: "fallback", reason: j.fallbackReason ?? "AI 暂不可用", digest: j.digest ?? null });
      } else if (j.review) {
        setReview({ kind: "ai", review: j.review, cached: Boolean(j.cached), generatedAt: j.generatedAt ?? "" });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  }, [accountId]);

  const st = digest?.stats;
  const facts =
    review?.kind === "fallback" ? (review.digest?.facts ?? digest?.facts ?? "").split("\n").filter(Boolean) : [];

  return (
    <>
      {/* 统计卡（规则统计，常显） */}
      <View className="glass glass-p5 trade-card">
        <View className="sec-head">
          <Chip icon="bar_chart_3" label="统计" tone="amber" />
          {st && (
            <Text className="sec-sub">
              {st.totalTrades} 笔 · 净 {fmtUsd(st.totalNet)}
            </Text>
          )}
        </View>
        {!digest ? (
          digestErr ? (
            <View className="sec-loadfail">
              <Text className="sec-loadfail-text">加载失败：{digestErr}</Text>
              <Button className="btn-primary sec-retry" hoverClass="press" onClick={() => setRev((r) => r + 1)}>
                重试
              </Button>
            </View>
          ) : (
            <View className="fin-skeleton">
              <View className="skeleton fin-skeleton-row" />
              <View className="skeleton fin-skeleton-row" style={{ opacity: 0.82 }} />
            </View>
          )
        ) : (
          <View className="digest-body">
            {/* 峰值前后两阶段对比 */}
            <View className="phase-grid">
              {(["beforePeak", "afterPeak"] as const).map((kk) => {
                const ph = st!.phases[kk];
                return (
                  <View key={kk} className="phase-card cell-bg">
                    <Text className="ov-label">
                      {kk === "beforePeak" ? "峰值前" : "峰值后"}
                      {kk === "beforePeak" && st!.peak ? `（≤ ${st!.peak.ymd}）` : ""}
                    </Text>
                    <Text className={`phase-num ${pnlTone(ph.net)}`}>{fmtUsd(ph.net)}</Text>
                    <Text className="eq-stat-sub">
                      {ph.count} 笔 · 胜率 {ph.winRate != null ? `${ph.winRate}%` : "—"}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* 回撤段列表 */}
            {st!.drawdowns.length > 0 && (
              <View className="agg">
                <Text className="agg-title">回撤段（按深度）</Text>
                {st!.drawdowns.map((d, i) => (
                  <View key={`${d.startYmd}-${d.troughYmd}-${i}`} className="dd-row">
                    <Text className="hint-faint">{i + 1}.</Text>
                    <Text className="dd-range">
                      {d.startYmd} → {d.troughYmd}
                      {d.endYmd !== d.troughYmd ? `（至 ${d.endYmd}）` : ""}
                    </Text>
                    <Text className="dd-amt money-out">-{fmtUsd(d.amount)}</Text>
                  </View>
                ))}
              </View>
            )}

            <AggList title="开仓时段" rows={digest.aggregations.byPeriod} />
            <AggList title="持仓时长" rows={digest.aggregations.byDuration} />
            <AggList title="方向" rows={digest.aggregations.byDirection} />

            {/* 典型逐笔 */}
            {digest.notable.length > 0 && (
              <View className="agg">
                <Text className="agg-title">典型逐笔</Text>
                {digest.notable.map((t, i) => (
                  <View key={`${t.label}-${t.ticket}-${i}`} className="dd-row">
                    <Text className={`notable-tag ${t.netProfit >= 0 ? "notable-up" : "notable-down"}`}>{t.label}</Text>
                    <Text className="dd-range">
                      #{t.ticket} · {t.symbol} · {t.direction === "buy" ? "买入" : "卖出"} {t.lots} 手
                    </Text>
                    <Text className="hint-faint">{bjTime(t.closeTime)}</Text>
                    <Text className={`notable-net ${pnlTone(t.netProfit)}`}>{fmtUsd(t.netProfit)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* AI 复盘卡 */}
      <View className="glass glass-p5 trade-card">
        <View className="ai-head">
          <View className="ai-head-l">
            <Chip icon="sparkles" label="AI 复盘" tone="emerald" />
            {review?.kind === "fallback" && <Text className="fallback-badge">已降级</Text>}
            {review?.kind === "ai" && (
              <Text className="hint-faint">
                {review.cached ? "缓存" : "已生成"}
                {review.generatedAt ? ` · ${bjTime(review.generatedAt)}` : ""}
              </Text>
            )}
          </View>
          <Button className={`ai-gen-btn ${genBusy ? "disabled" : ""}`} disabled={genBusy} hoverClass="press" onClick={() => void generate()}>
            {genBusy ? "生成中…" : review ? "重新生成" : "生成复盘"}
          </Button>
        </View>

        {error && <View className="msg-banner msg-banner-err ai-err">{error}</View>}

        {review?.kind === "ai" ? (
          <View className="ai-body">
            <Text className="ai-summary">{review.review.summary}</Text>
            {review.review.highlights.length > 0 && (
              <View className="ai-list">
                {review.review.highlights.map((h, i) => (
                  <Text key={i} className="ai-line">
                    <Text className="money-in">◆</Text>
                    {h}
                  </Text>
                ))}
              </View>
            )}
            {review.review.suggestions.length > 0 && (
              <View className="ai-list ai-sug">
                {review.review.suggestions.map((s, i) => (
                  <Text key={i} className="ai-line ai-line-dim">
                    <Text className="ai-mark">✦</Text>
                    {s}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ) : review?.kind === "fallback" ? (
          <View className="fallback-body">
            <Text className="fallback-warn">AI 暂不可用（{review.reason}），以下为规则统计结论。</Text>
            {facts.length > 0 ? (
              <View className="fallback-facts">
                {facts.map((f, i) => (
                  <Text key={i} className="fallback-fact">
                    <Text className="hint-faint">· </Text>
                    {f}
                  </Text>
                ))}
              </View>
            ) : (
              <Text className="sec-empty">暂无统计数据</Text>
            )}
          </View>
        ) : (
          !genBusy && (
            <Text className="rev-ai-empty">点「生成复盘」让 AI 解读该账号的交易行为（走 AI 配额，结果缓存；失败自动降级为规则统计）</Text>
          )
        )}
      </View>
    </>
  );
}

/* ==================================================================== */

export default function TradingPage() {
  const [accounts, setAccounts] = useState<TradingAccount[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [modules, setModules] = useState<string[] | null>(null);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [quickMsg, setQuickMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rev, setRev] = useState(0); // 同步成功后重建子区（= web key={activeId-rev}）
  const [inited, setInited] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const j = await loadAccounts();
      setAccounts(j.accounts);
      setActiveId((cur) => (cur && j.accounts.some((a) => a.id === cur) ? cur : j.accounts[0]?.id ?? null));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
        setAccounts([]);
        return;
      }
      // 非 403 的失败不停在骨架屏
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken()) return;
    setInited(true);
    void load();
    fetchMe()
      .then((j) => setModules(j.modules ?? []))
      .catch(() => setModules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    load()
      .then(() => setRev((r) => r + 1))
      .finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell active="finance">
        <GuestGate title="交易账户" desc="Bitget 合约交易同步、每日盈亏与手数统计" />
      </PageShell>
    );
  }

  /** 一键同步：对每把已绑定的 Bitget 密钥各做一次增量同步；未绑定密钥提示去 web 绑定（= web 打开绑定抽屉） */
  const quickSync = useCallback(async () => {
    if (quickSyncing) return;
    setQuickSyncing(true);
    setQuickMsg(null);
    try {
      const st = await loadBitgetKeys();
      const labels = st.keys?.map((kk) => kk.label) ?? [];
      if (labels.length === 0) {
        setQuickMsg({ ok: false, text: "尚未绑定 Bitget API 密钥，请先在 web 端「⚙」绑定" });
        return;
      }
      const parts: string[] = [];
      for (const label of labels) {
        const r = await syncBitget(label);
        parts.push(`「${label}」${r.fromUsed}~${r.toUsed} 新增 ${r.rowsNew} · 重复 ${r.rowsDup}`);
      }
      setQuickMsg({ ok: true, text: `✅ 同步完成：${parts.join("；")}` });
      await load();
      setRev((r) => r + 1);
    } catch (e) {
      setQuickMsg({ ok: false, text: e instanceof ApiError ? e.message : "同步失败，请稍后再试" });
    } finally {
      setQuickSyncing(false);
    }
  }, [quickSyncing, load]);

  const active = useMemo(() => accounts?.find((a) => a.id === activeId) ?? null, [accounts, activeId]);
  const hasModule = modules?.includes("trading") ?? false;

  if (locked || (modules !== null && !hasModule)) {
    return (
      <PageShell active="finance">
        <ModuleLocked title="交易" desc="该模块由管理员授权后开放，可联系管理员开通。" />
        <PageFooter icon="trending_up" label="交易" />
      </PageShell>
    );
  }

  return (
    <PageShell active="finance">
      <View className="fin-hero">
        <View className="fin-hero-line">
          <Text className="hero text-gradient">拾光</Text>
          <Text className="fin-hero-sub">交易</Text>
        </View>
        <Text className="fin-hero-tip">MT5 报表 / Bitget CFD 同步 · 权益曲线 · 归类复盘 —— 盈亏看得清</Text>
      </View>

      <FinTabs modules={modules} />

      {/* 已有账号数据时的刷新失败提示（首次加载失败走下方整页错误态） */}
      {accounts && loadErr ? (
        <View className="msg-banner msg-banner-err">
          加载失败：{loadErr}
          <View className="retry-link" onTap={() => void load()}>
            重试
          </View>
        </View>
      ) : null}

      {!accounts ? (
        loadErr ? (
          <View className="loadfail">
            <Text className="loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary loadfail-btn" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          <FinSkeleton rows={4} />
        )
      ) : (
        <>
          {/* 账号切换 + 汇总卡 + 同步入口 */}
          <View className="glass glass-p5 trade-card">
            <View className="acc-row">
              <Chip icon="target" label="交易账号" tone="sky" />
              <View className="acc-chips">
                {accounts.map((a) => (
                  <View
                    key={a.id}
                    className={`tf-chip ${a.id === activeId ? "tf-chip-on" : ""}`}
                    onTap={() => setActiveId(a.id)}
                  >
                    {a.source === "bitget" ? <LucideIcon name="zap" size={10} color="currentColor" /> : null}
                    <Text>{a.nickname ? `${a.login} · ${a.nickname}` : a.login}</Text>
                  </View>
                ))}
                {accounts.length === 0 && <Text className="sec-empty-inline">暂无账号</Text>}
              </View>
              {/* 一键同步全端开放（= web 注释口径）；⚙ 绑定抽屉表单重，提示走 web */}
              <View className={`sync-btn ${quickSyncing ? "disabled" : ""}`} hoverClass="press" onTap={() => void quickSync()}>
                {quickSyncing ? (
                  "同步中…"
                ) : (
                  <View className="ico-row">
                    <LucideIcon name="zap" size={12} color="currentColor" />
                    <Text>一键同步</Text>
                  </View>
                )}
              </View>
              <View
                className="cfg-btn"
                hoverClass="press"
                onTap={() => setQuickMsg({ ok: false, text: "Bitget 密钥绑定/自定义同步请使用 web 端" })}
              >
                <LucideIcon name="settings" size={14} color="currentColor" />
              </View>
            </View>

            {quickMsg && <Text className={`quick-msg ${quickMsg.ok ? "quick-ok" : "quick-err"}`}>{quickMsg.text}</Text>}

            {active && (
              <View className="acct-stats">
                <View className="acct-stat">
                  <Text className="ov-label">总净盈亏</Text>
                  <Text className={`ov-num ${pnlTone(active.netProfit)}`}>{fmtUsd(active.netProfit)}</Text>
                </View>
                <View className="acct-stat">
                  <Text className="ov-label">胜率</Text>
                  <Text className="ov-num">{active.winRate != null ? `${active.winRate}%` : "—"}</Text>
                </View>
                <View className="acct-stat">
                  <Text className="ov-label">笔数</Text>
                  <Text className="ov-num">{Number(active.trades) || 0}</Text>
                </View>
                <View className="acct-stat">
                  <Text className="ov-label">总手数</Text>
                  <Text className="ov-num">{(Number(active.lots) || 0).toFixed(2)}</Text>
                </View>
                <View className="acct-stat acct-stat-wide">
                  <Text className="ov-label">平仓区间</Text>
                  <Text className="acct-range">
                    {active.firstClose ? bjDate(active.firstClose) : "—"}
                    {active.lastClose ? ` ~ ${bjDate(active.lastClose)}` : ""}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {accounts.length === 0 ? (
            <View className="glass glass-p5 trade-card trade-empty">
              <Text>还没有交易账号 —— 点「⚡ 一键同步」绑定自己的只读 API 手动拉取；MT5 用户在 PC 端「📥 导入报表」</Text>
            </View>
          ) : (
            activeId && (
              <View key={`${activeId}-${rev}`}>
                <DailySection accountId={activeId} />
                <EquitySection accountId={activeId} />
                <TradesSection accountId={activeId} />
                <DigestSection accountId={activeId} />
              </View>
            )
          )}

          <Text className="fin-footer">拾光 · 交易 · 独立核算不入净资产，统计零 AI 消耗</Text>
        </>
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="trending_up" label="交易" />
    </PageShell>
  );
}
