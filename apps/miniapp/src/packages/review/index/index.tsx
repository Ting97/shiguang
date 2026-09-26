import { useRef, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { yuan, bjToday } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { loadWeekStats, getWeekReview, genWeekReview, type WeekStats, type WeekReview } from "./api";
import "./index.scss";

/**
 * 收支复盘分包页：周收支对比 + 分类 Top（GET /api/finance/stats?period=week）+ AI 周报（/api/finance/review/week）。
 * 统计零 AI 消耗；周报 GET 只读缓存、POST 才生成（走配额），错误（402/429/503…）直接展示服务端中文 message。
 */

/** 北京日历日工具：与 packages/shared/date 同口径（UTC getter + 8h），小程序端就地实现 */
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

export default function ReviewPage() {
  // anchor=锚点日（默认北京今天），range 由 mondayOf 归一到周一~周日
  const [anchor, setAnchor] = useState(bjToday());
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [review, setReview] = useState<WeekReview | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; generatedAt?: string } | null>(null);
  // 周报错误单独放 AI 卡内做徽标：统计挂了不应连带隐藏（反之亦然）
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [inited, setInited] = useState(false);
  // 取数序号：快速翻周时旧响应可能后到，仅最新一次请求的响应可落地（对齐 web 复盘页 seq 范式）
  const loadSeq = useRef(0);

  const rangeFrom = mondayOf(anchor);

  /** 统计 + 周报缓存并行拉取；统计挂了给出重试横幅，周报缓存挂了只在 AI 卡内提示 */
  async function load(anchorDate = anchor) {
    const seq = ++loadSeq.current;
    const from = mondayOf(anchorDate);
    setStatsErr(null);
    try {
      const s = await loadWeekStats(from);
      if (seq !== loadSeq.current) return;
      setStats(s);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setStats(null);
      setStatsErr(e?.message ?? "加载失败");
    }
    setReviewErr(null);
    try {
      const j = await getWeekReview(from);
      if (seq !== loadSeq.current) return;
      if (j.review) {
        setReview(j.review);
        setMeta({ cached: j.cached !== false, generatedAt: j.generatedAt });
      } else {
        setReview(null);
        setMeta(null);
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      // 缓存读取失败（403 未开通/网络抖动）不阻塞统计区，只在 AI 卡提示
      setReview(null);
      setMeta(null);
      setReviewErr(e?.message ?? "周报读取失败");
    }
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    void load();
  }

  usePullDownRefresh(() => {
    load().finally(() => Taro.stopPullDownRefresh());
  });

  function shiftWeek(delta: number) {
    const next = addDays(anchor, delta * 7);
    setAnchor(next);
    setReview(null);
    setMeta(null);
    void load(next);
  }

  /** 生成/重新生成周报：refresh=true 绕过缓存；402 配额、429 限频、503 未配置 AI 的 message 直接当徽标文案 */
  async function generate() {
    if (genBusy) return;
    setGenBusy(true);
    setReviewErr(null);
    try {
      const j = await genWeekReview(rangeFrom, true);
      if (j.review) {
        setReview(j.review);
        setMeta({ cached: !!j.cached, generatedAt: j.generatedAt });
      } else {
        setReview(null);
        setMeta(null);
      }
    } catch (e: any) {
      setReview(null);
      setMeta(null);
      setReviewErr(e?.message ?? "生成失败");
    } finally {
      setGenBusy(false);
    }
  }

  const from = rangeFrom;
  const to = addDays(rangeFrom, 6);
  const rangeLabel = `${Number(from.slice(5, 7))}/${Number(from.slice(8, 10))} ~ ${Number(to.slice(5, 7))}/${Number(to.slice(8, 10))}`;
  const isCurrentWeek = mondayOf(bjToday()) === from;

  const out = stats?.totals.outCents ?? 0;
  const inc = stats?.totals.inCents ?? 0;
  const outMom = stats ? momPct(out, stats.prev.outCents) : null;
  const inMom = stats ? momPct(inc, stats.prev.inCents) : null;
  // 周内日趋势柱高：以 7 天里最大的单边金额为满高基准（max(1,…) 防全零除零）
  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => Math.max(d.outCents, d.inCents))) : 1;

  return (
    <View className="page-pad">
      {/* 周切换导航：‹ › 翻周；「今」回当前周（未来周不禁，看了也是全零） */}
      <View className="week-row">
        <Text className="nav-btn" onClick={() => shiftWeek(-1)}>‹</Text>
        <Text className="week-title">{rangeLabel}</Text>
        <Text className="nav-btn" onClick={() => shiftWeek(1)}>›</Text>
        {!isCurrentWeek && (
          <Text className="today-btn" onClick={() => { setAnchor(bjToday()); void load(bjToday()); }}>今</Text>
        )}
      </View>

      {statsErr && <View className="banner banner-err">加载失败：{statsErr}</View>}

      {/* 周收支对比卡 */}
      {stats && (
        <View className="card">
          <View className="sum-grid">
            <View className="sum-cell">
              <Text className="dim">本周支出</Text>
              <Text className="sum-num money-out">¥{yuan(out)}</Text>
              {outMom != null && (
                <Text className={`mom ${outMom > 0 ? "money-out" : "money-in"}`}>
                  环比 {outMom > 0 ? "+" : ""}{outMom}%
                </Text>
              )}
            </View>
            <View className="sum-cell">
              <Text className="dim">本周收入</Text>
              <Text className="sum-num money-in">¥{yuan(inc)}</Text>
              {inMom != null && (
                <Text className={`mom ${inMom > 0 ? "money-in" : "money-out"}`}>
                  环比 {inMom > 0 ? "+" : ""}{inMom}%
                </Text>
              )}
            </View>
            <View className="sum-cell">
              <Text className="dim">结余</Text>
              <Text className={`sum-num ${inc - out >= 0 ? "money-in" : "money-out"}`}>¥{yuan(inc - out)}</Text>
              <Text className="dim">{stats.totals.count} 笔</Text>
            </View>
          </View>
        </View>
      )}

      {/* 周内日趋势：支出红/收入绿双柱，缺失日补零（服务端 daily 恒 7 天） */}
      {stats && stats.daily.length > 0 && (
        <View className="card">
          <Text className="h2">📊 日趋势</Text>
          <View className="trend">
            {stats.daily.map((d) => (
              <View key={d.date} className="trend-col">
                <View className="trend-bars">
                  <View
                    className="t-bar out"
                    style={{ height: d.outCents > 0 ? `${Math.max(4, Math.round((d.outCents / maxDaily) * 120))}px` : "4px" }}
                  />
                  <View
                    className="t-bar in"
                    style={{ height: d.inCents > 0 ? `${Math.max(4, Math.round((d.inCents / maxDaily) * 120))}px` : "4px" }}
                  />
                </View>
                <Text className="dim trend-day">{Number(d.date.slice(8))}</Text>
              </View>
            ))}
          </View>
          <Text className="legend dim">
            <Text className="money-out">▮</Text> 支出  <Text className="money-in">▮</Text> 收入
          </Text>
        </View>
      )}

      {/* 支出分类 Top：金额占比条 */}
      {stats && stats.byCategory.length > 0 && (
        <View className="card">
          <Text className="h2">🧩 支出分类 Top</Text>
          {stats.byCategory.slice(0, 5).map((c) => (
            <View key={c.category} className="cat-row">
              <Text className="cat-name">{c.category}</Text>
              <View className="cat-bar">
                <View className="cat-bar-in" style={{ width: `${Math.min(100, c.pct)}%` }} />
              </View>
              <Text className="cat-amt money-out">¥{yuan(c.cents)}</Text>
              <Text className="dim cat-pct">{c.pct}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* AI 周报卡：GET 只读缓存；生成按钮走配额；错误徽标直出服务端文案 */}
      <View className="card">
        <View className="ai-head">
          <Text className="h2">🤖 AI 周报</Text>
          <View className="ai-head-right">
            {meta && review && (
              <Text className="dim">{meta.cached ? "缓存" : "已生成"}{meta.generatedAt ? ` · ${bjMD(meta.generatedAt)}` : ""}</Text>
            )}
            <Button
              className={`ai-btn ${genBusy ? "disabled" : ""}`}
              disabled={genBusy}
              onClick={generate}
            >
              {genBusy ? "生成中…" : review ? "重新生成" : "生成周报"}
            </Button>
          </View>
        </View>

        {reviewErr && <View className="banner banner-err ai-err">{reviewErr}</View>}

        {genBusy && !review && <Text className="dim ai-busy">正在读取本周流水并生成解读…</Text>}

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
          !genBusy && !reviewErr && <Text className="dim">点「生成周报」让 AI 解读本周收支（走 AI 配额，结果缓存）</Text>
        )}
      </View>
    </View>
  );
}
