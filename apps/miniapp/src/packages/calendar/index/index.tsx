/**
 * 日程内 AI 复盘 · 完整页（分包 packages/calendar，页面路由在 app.config.ts 冻结保留）：
 * 从日程页日视图「当日结构」卡的「查看完整复盘」navigateTo 进入，带 kind=day|week|month|year & period。
 * 小结的取数/生成逻辑在共享组件 pages/schedule/review-card.tsx（= web review-card 那套），
 * 本页补齐：周期种类切换 + ‹›翻周期 + 有无记录判定（day/week 查块、month/year 查聚合）。
 */
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { getSessionToken } from "@/lib/session";
import ReviewCard from "@/pages/schedule/review-card";
import { loadBlocksRange, loadStatsRange } from "./api";
import { addDays, bjMondayOf, bjToday, startOfYear, weekName, zhDate } from "@/pages/schedule/date";
import "./index.scss";
import GuestGate from "@/components/guest-gate";

type Kind = "day" | "week" | "month" | "year";

const KINDS: [Kind, string][] = [
  ["day", "日"],
  ["week", "周"],
  ["month", "月"],
  ["year", "年"],
];

/** 各周期的回退锚点（今天/本周/本月/今年，= 北京口径） */
function defaultAnchor(): string {
  return bjToday();
}

/** 锚定日 → 各周期的 period 键（week 归一到周一：后端缓存键 = 周一） */
function periodOf(kind: Kind, anchor: string): string {
  if (kind === "day") return anchor;
  if (kind === "week") return bjMondayOf(anchor);
  if (kind === "month") return anchor.slice(0, 7);
  return anchor.slice(0, 4);
}

export default function CalendarReviewPage() {
  const router = Taro.useRouter();
  const paramKind = router.params.kind;
  const paramPeriod = router.params.period;
  const validKind: Kind = paramKind === "week" || paramKind === "month" || paramKind === "year" ? paramKind : "day";
  // 入参 period 合法才采纳（day/week 收日期、month 收 YYYY-MM、year 收 YYYY），否则回北京今天
  const [anchor, setAnchor] = useState(() => {
    if (!paramPeriod) return defaultAnchor();
    if (validKind === "year") return /^\d{4}$/.test(paramPeriod) ? `${paramPeriod}-06-15` : defaultAnchor();
    if (validKind === "month") return /^\d{4}-\d{2}$/.test(paramPeriod) ? `${paramPeriod}-15` : defaultAnchor();
    return /^\d{4}-\d{2}-\d{2}$/.test(paramPeriod) ? paramPeriod : defaultAnchor();
  });
  const [kind, setKind] = useState<Kind>(validKind);
  const [hasRecords, setHasRecords] = useState(false);
  const [recLoading, setRecLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [reviewErr, setReviewErr] = useState<string | null>(null);

  const period = periodOf(kind, anchor);

  // 换周期清上一周期的生成错误横幅
  useEffect(() => {
    setReviewErr(null);
  }, [kind, period]);

  // 周期副标题（= web 卡头 ml-2 日期段）
  let subLabel = "";
  if (kind === "day") subLabel = `${zhDate(anchor)} ${weekName(anchor)}`;
  else if (kind === "week") {
    const mon = bjMondayOf(anchor);
    subLabel = `${mon} – ${addDays(mon, 6)}`;
  } else if (kind === "month") subLabel = `${Number(anchor.slice(0, 4))}年${Number(anchor.slice(5, 7))}月`;
  else subLabel = `${anchor.slice(0, 4)} 年`;

  // 有无记录：块 + 动态/流水/完成 todo（hasExtras，与 web review 卡口径一致），month/year 用聚合
  useEffect(() => {
    let alive = true;
    setRecLoading(true);
    (async () => {
      try {
        if (kind === "day") {
          const j = await loadBlocksRange(period, period);
          if (alive) setHasRecords((j.blocks ?? []).length > 0 || j.hasExtras === true);
        } else if (kind === "week") {
          const mon = bjMondayOf(anchor);
          const j = await loadBlocksRange(mon, addDays(mon, 6));
          if (alive) setHasRecords((j.blocks ?? []).length > 0 || j.hasExtras === true);
        } else if (kind === "month") {
          const [y, m] = period.split("-").map(Number);
          const j = await loadStatsRange(`${period}-01`, `${period}-${new Date(y, m, 0).getDate()}`.slice(0, 10));
          if (alive) setHasRecords((j.days ?? []).length > 0 || j.hasExtras === true);
        } else {
          const j = await loadStatsRange(startOfYear(period), `${period.slice(0, 4)}-12-31`);
          if (alive) setHasRecords((j.days ?? []).length > 0 || j.hasExtras === true);
        }
      } catch {
        if (alive) setHasRecords(false);
      } finally {
        if (alive) setRecLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, period]); // eslint-disable-line react-hooks/exhaustive-deps

  usePullDownRefresh(() => {
    setRefreshTick((n) => n + 1);
    Taro.stopPullDownRefresh();
  });

  function shift(dir: 1 | -1) {
    if (kind === "day") setAnchor(addDays(anchor, dir));
    else if (kind === "week") setAnchor(addDays(anchor, dir * 7));
    else if (kind === "month") {
      // 钉回 15 号再翻月（29~31 日翻月会滚到下下月）
      const d = `${anchor.slice(0, 8)}15`;
      const [y, m] = d.split("-").map(Number);
      const nd = new Date(y, m - 1 + dir, 1);
      setAnchor(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-15`);
    } else setAnchor(`${Number(anchor.slice(0, 4)) + dir}-06-15`);
  }

  function back() {
    // 详情页必须有可见返回（README 铁律）；栈空（分享直达）兜底回日程页
    Taro.navigateBack({ fail: () => Taro.redirectTo({ url: "/pages/schedule/index" }) });
  }

  // 未登录不拉数据（请求层 401 会跳登录）
  if (!getSessionToken()) {
    return (
      <PageShell active="schedule">
        <GuestGate title="日历" desc="日 / 周 / 月 / 年四视图时间轴与 AI 复盘" />
      </PageShell>
    );
  }

  return (
    <PageShell active="schedule">
      <View className="cr-wrap">
        {/* 顶行：返回 + 标题（= web 详情页同位置的返回链） */}
        <View className="cr-top">
          <View className="cr-back" onTap={back}>
            ‹ 返回
          </View>
          <Text className="cr-title">AI 复盘</Text>
          <View className="cr-top-pad" />
        </View>

        {/* 周期种类 pill（= web 视图切换 pill 组样式） */}
        <View className="cr-kinds">
          {KINDS.map(([k, label]) => (
            <View
              key={k}
              className={`cr-kind ${kind === k ? "active" : ""}`}
              onTap={() => setKind(k)}
            >
              {label}
            </View>
          ))}
        </View>

        {/* 周期导航：‹ › + 回到当前周期 */}
        <View className="cr-nav">
          <View className="cr-arrow" onTap={() => shift(-1)}>
            ‹
          </View>
          <Text className="cr-period">{subLabel}</Text>
          <View className="cr-arrow" onTap={() => shift(1)}>
            ›
          </View>
          <View
            className="cr-today"
            onTap={() => setAnchor(defaultAnchor())}
          >
            现在
          </View>
        </View>

        {/* AI 小结卡（周期种类为 day 时也用大卡形态：完整页的独立复盘视图） */}
        {reviewErr && (
          <View className="msg-banner msg-banner-err">
            <Text>{reviewErr}</Text>
          </View>
        )}
        {recLoading ? (
          <Text className="cr-loading">加载中…</Text>
        ) : (
          <ReviewCard
            key={`rc-${kind}-${period}-${refreshTick}`}
            kind={kind}
            period={period}
            subLabel={subLabel}
            hasRecords={hasRecords}
            notify={setReviewErr}
            variant="card"
          />
        )}
      </View>
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="calendar_days" label="日历" />
    </PageShell>
  );
}
