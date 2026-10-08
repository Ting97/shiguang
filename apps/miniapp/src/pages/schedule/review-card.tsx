/**
 * AI 复盘卡（= web app/calendar/{day,week,month,year}-review-card 合一）：
 * - 挂载/周期切换时 GET /api/review 只读拉上次持久化的小结（不耗次数），本次生成的结果优先展示；
 * - variant="inline"：日小结卡（日程页当日结构卡内部，border-t 分隔的小号排版 = web DayReviewCard）；
 *   variant="card"：周/月/年独立玻璃卡（glass rounded-2xl p-5 = web Week/Month/YearReviewCard）。
 * - 日卡带「查看完整复盘」→ packages/calendar 完整页（小程序独有入口，web 无此页）。
 */
import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import LucideIcon from "../../components/lucide-icon";
import { generateReview, loadCachedReview, type ReviewBody, type ReviewKind } from "./api";

/** 生成时间 → 北京时间 MM-DD HH:MM（web: +8h 后 slice(5,16)） */
function bjStamp(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000)
    .toISOString()
    .slice(5, 16)
    .replace("T", " ");
}

const KIND_LABEL: Record<ReviewKind, string> = { day: "AI 日小结", week: "AI 周报", month: "AI 月报", year: "AI 年报" };
const BTN_TEXT: Record<ReviewKind, string> = { day: "生成小结", week: "生成本周小结", month: "生成本月小结", year: "生成本年小结" };
const READING: Record<ReviewKind, string> = {
  day: "正在通读当天记录…",
  week: "正在通读本周的时间/todo/收支/人际…",
  month: "正在通读本月的时间/todo/收支/人际…",
  year: "正在通读本年的时间/todo/收支/人际…",
};
const IDLE_HINT: Record<ReviewKind, string> = {
  day: "让 AI 通读当天的时间/todo/收支/人际，写一份小结",
  week: "让 AI 通读本周的时间投入/todo/收支/人际，总结这一周",
  month: "让 AI 通读本月的时间投入/todo/收支/人际，总结这一个月",
  year: "让 AI 通读本年的时间投入/todo/收支/人际，总结这一年",
};
const EMPTY_TEXT: Record<ReviewKind, string> = {
  day: "当天还没有记录",
  week: "本周还没有记录",
  month: "本月还没有记录",
  year: "本年还没有记录",
};

export default function ReviewCard({
  kind,
  period,
  subLabel,
  hasRecords,
  notify,
  variant = "card",
  onOpenFull,
}: {
  kind: ReviewKind;
  /** day/week=YYYY-MM-DD（week 传周一，与后端缓存键一致）；month=YYYY-MM；year=YYYY */
  period: string;
  /** 卡头周期副标题（= web ml-2 的日期段：周传 "起 – 止"，月 "M 月"，年 "YYYY 年"） */
  subLabel?: string;
  hasRecords: boolean;
  /** 生成失败的出报通道（日程页接 err 横幅，完整页接卡内徽标） */
  notify: (e: string | null) => void;
  variant?: "inline" | "card";
  /** 日卡「查看完整复盘」回调（小程序独有：跳 packages/calendar 完整页） */
  onOpenFull?: () => void;
}) {
  // 缓存只读拉取：period 变化即重拉；失败静默（复盘是增强内容，不阻塞主视图）
  const [cached, setCached] = useState<ReviewBody | null>(null);
  const [review, setReview] = useState<ReviewBody | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setCached(null);
    setReview(null);
    if (!period) return;
    loadCachedReview(kind, period)
      .then((j) => {
        if (alive && j?.review) setCached(j.review);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind, period]);

  const shown = review ?? cached; // 本次会话生成结果优先，否则用上次持久化的小结

  async function generate() {
    if (busy) return;
    // 无记录周期不给生成：按钮只是视觉置灰（View 无 disabled），守卫拦住才能避免白烧一次 AI 配额
    if (!hasRecords) return;
    setBusy(true);
    try {
      // 已有小结（含上次持久化的）时 refresh:true 强制刷新（= web 重新生成语义）
      const j = await generateReview(kind, period, shown != null);
      setGeneratedAt(j.generatedAt ?? null);
      setReview(j.review);
    } catch (e: any) {
      notify(e?.message ?? "AI 解读失败");
    } finally {
      setBusy(false);
    }
  }

  const sections = shown?.sections ?? [];
  const highlights = shown?.highlights ?? [];
  const suggestions = shown?.suggestions ?? [];

  /* ---- 日小结（inline：web DayReviewCard 的 border-t 小号排版） ---- */
  if (variant === "inline") {
    return (
      <View className="rc rc-inline">
        <View className="rc-head">
          {/* = web TagChip tone=violet size=sm「AI 日小结」 */}
          <View className="rc-title-row">
            <View className="chip chip-violet chip-sm ico-row">
            <LucideIcon name="sparkles" size={11} color="currentColor" />
            <Text>{KIND_LABEL[kind]}</Text>
          </View>
            {generatedAt && review && <Text className="rc-stamp">生成于 {bjStamp(generatedAt)}</Text>}
          </View>
          <View
            className={`btn-purple-tinted rc-btn-sm ${busy || !hasRecords ? "disabled" : ""}`}
            onTap={generate}
          >
            {busy ? "解读中…" : shown ? "重新生成" : BTN_TEXT[kind]}
          </View>
        </View>
        {busy && <Text className="rc-line rc-dim ai-text pulse">{READING[kind]}</Text>}
        {!busy && !shown && !hasRecords && <Text className="rc-line rc-faint">{EMPTY_TEXT[kind]}</Text>}
        {!busy && !shown && hasRecords && <Text className="rc-line rc-faint">{IDLE_HINT[kind]}</Text>}
        {!busy && shown && (
          <View className="rc-body">
            <Text className="rc-summary">{shown.summary}</Text>
            {highlights.length > 0 &&
              highlights.map((h, i) => (
                <View key={`h${i}`} className="rc-line">
                  <View className="rc-dot ok" />
                  <Text className="rc-item ok-text">{h}</Text>
                </View>
              ))}
            {suggestions.length > 0 &&
              suggestions.map((s, i) => (
                <View key={`s${i}`} className="rc-line">
                  <View className="rc-tip"><LucideIcon name="zap" size={12} color="var(--warn)" /></View>
                  <Text className="rc-item accent-text">{s}</Text>
                </View>
              ))}
          </View>
        )}
        {onOpenFull && (
          <View className="rc-full-link" hoverClass="press" hoverStayTime={80} onTap={onOpenFull}>
            <Text>查看完整复盘 ›</Text>
          </View>
        )}
      </View>
    );
  }

  /* ---- 周/月/年独立玻璃卡（web Week/Month/YearReviewCard：glass rounded-2xl p-5） ---- */
  return (
    <View className="glass glass-p5 rc rc-card">
      <View className="rc-head">
        <View className="rc-title-row">
          <View className="chip chip-violet ico-row">
          <LucideIcon name="sparkles" size={11} color="currentColor" />
          <Text>{KIND_LABEL[kind]}</Text>
        </View>
          <Text className="rc-period dim-soft">{subLabel ?? period}</Text>
        </View>
        <View
          className={`btn-purple-tinted rc-btn ${busy || !hasRecords ? "disabled" : ""}`}
          onTap={generate}
        >
          {busy ? "解读中…" : shown ? "重新生成" : BTN_TEXT[kind]}
        </View>
      </View>
      {busy && <Text className="rc-line rc-dim ai-text pulse">{READING[kind]}</Text>}
      {!busy && !shown && !hasRecords && <Text className="rc-line rc-faint">{EMPTY_TEXT[kind]}</Text>}
      {!busy && !shown && hasRecords && <Text className="rc-line rc-faint">{IDLE_HINT[kind]}</Text>}
      {!busy && shown && (
        <View className="rc-body">
          <Text className="rc-summary">{shown.summary}</Text>
          {sections.map((s, i) => (
            <View key={`sec${i}`}>
              <Text className="rc-sec-title">▎{s.title}</Text>
              <Text className="rc-sec-text">{s.text}</Text>
            </View>
          ))}
          {highlights.length > 0 &&
            highlights.map((h, i) => (
              <View key={`h${i}`} className="rc-line">
                <View className="rc-dot ok" />
                <Text className="rc-item ok-text">{h}</Text>
              </View>
            ))}
          {suggestions.length > 0 &&
            suggestions.map((s, i) => (
              <View key={`s${i}`} className="rc-line">
                <View className="rc-tip"><LucideIcon name="zap" size={12} color="var(--warn)" /></View>
                <Text className="rc-item accent-text">{s}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}
