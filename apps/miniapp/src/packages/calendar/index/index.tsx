import { useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadBlocksRange, loadTodos, bjToday } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { loadCachedDayReview, generateDayReview, type DayReview } from "./api";
import "./index.scss";

/** ISO → 北京时区日历日键 YYYY-MM-DD（对齐 web lib/bj-time bjDateKey：UTC getter + 8h，本地 getter 海外设备会错 8h） */
function bjDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** ISO → 北京 HH:MM（同上口径） */
function bjHM(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** YYYY-MM-DD ±n 天（用 Date.UTC 组装，避免 Date.parse 裸串被宿主时区解释成前一天） */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → 「M月D日 周X」 */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const week = ["日", "一", "二", "三", "四", "五", "六"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日 周${week}`;
}

export default function CalendarPage() {
  // 初始日期取路由 ?date=（schedule 页入口带今天）；非法/缺省回退北京今天
  const router = Taro.useRouter();
  const paramDate = router.params.date;
  const initial = paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate) ? paramDate : bjToday();

  const [date, setDate] = useState(initial);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [todos, setTodos] = useState<any[]>([]);
  const [review, setReview] = useState<DayReview | null>(null);
  const [reviewFail, setReviewFail] = useState<string | null>(null); // 生成失败的徽标文案（403 额度/502 上游）
  const [reviewBusy, setReviewBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh(d: string) {
    try {
      // 日程块：SQL 已按 start_at 排序并做过「与查询日有交集」过滤（跨天块会在覆盖的每一天重复出现）
      const b = await loadBlocksRange(d, d);
      setBlocks(b.blocks ?? []);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
    try {
      // 当日待办：view=all 只回未完成顶层 todo（done 视图无 due 语义），前端按北京日过滤；
      // due_at 是 timestamptz 用 bjDateKey 归一日；today_tag_date 是 date 列（JSON 可能带时区漂移）同样 +8h 归一
      const t = await loadTodos();
      const all = t.todos ?? [];
      setTodos(
        all.filter(
          (x: any) =>
            (x.due_at && bjDateKey(String(x.due_at)) === d) ||
            (x.today_tag_date && bjDateKey(String(x.today_tag_date)) === d),
        ),
      );
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
    // 日小结：先只读缓存（不耗 AI 次数）；无缓存不清空旧文案，避免切天闪空
    try {
      const r = await loadCachedDayReview(d);
      setReview(r.review ?? null);
      setReviewFail(null);
    } catch {
      /* 缓存读取失败静默：复盘卡是增强内容，不阻塞主列表 */
    }
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    void refresh(date);
  }

  usePullDownRefresh(() => {
    refresh(date).finally(() => Taro.stopPullDownRefresh());
  });

  function switchDay(days: number) {
    const next = shiftDate(date, days);
    setDate(next);
    setMsg(null);
    void refresh(next);
  }

  async function genReview() {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewFail(null);
    try {
      // 已有小结时 refresh:true 强制重生成（对齐 web day-review-card 语义）
      const j = await generateDayReview(date, review != null);
      setReview(j.review);
    } catch (e: any) {
      // 403=额度用尽 / 502=AI 失败，服务端文案已是中文，直接做徽标
      setReviewFail(e?.message ?? "AI 解读失败");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      {/* 日期切换条：‹ › 切天，超过北京今天的前后无限制（可看历史也可排未来） */}
      <View className="card date-bar">
        <Text className="date-arrow" onClick={() => switchDay(-1)}>
          ‹
        </Text>
        <Text className="date-title">{dayLabel(date)}</Text>
        <Text className="date-arrow" onClick={() => switchDay(1)}>
          ›
        </Text>
      </View>

      {/* 日程块 */}
      <View className="card">
        <Text className="h2">日程（{blocks.length}）</Text>
        {blocks.length === 0 && <Text className="dim">这一天没有日程块</Text>}
        {blocks.map((b) => (
          <View key={b.id} className="row">
            <View className="block-dot" style={{ backgroundColor: b.color || "var(--accent)" }} />
            <View className="grow">
              <Text className="row-title">{b.title}</Text>
              <Text className="dim">{b.activity_name || "未分类"}</Text>
            </View>
            <Text className="row-time">
              {bjHM(String(b.start_at))}–{bjHM(String(b.end_at))}
            </Text>
          </View>
        ))}
      </View>

      {/* 当日待办（未完成） */}
      <View className="card">
        <Text className="h2">待办（{todos.length}）</Text>
        {todos.length === 0 && <Text className="dim">这一天没有待办</Text>}
        {todos.map((t) => (
          <View key={t.id} className="row">
            <Text className="grow">{t.is_important ? "⭐ " : "☐ "}{t.title}</Text>
            {t.due_at && <Text className="dim">{bjHM(String(t.due_at))}</Text>}
          </View>
        ))}
      </View>

      {/* AI 日复盘卡 */}
      <View className="card">
        <View className="review-head">
          <Text className="h2">✨ AI 日小结</Text>
          <Text className={`review-btn ${reviewBusy ? "disabled" : ""}`} onClick={genReview}>
            {reviewBusy ? "解读中…" : review ? "重新生成" : "生成小结"}
          </Text>
        </View>
        {reviewFail && <View className="banner banner-err">{reviewFail}</View>}
        {!review && !reviewFail && !reviewBusy && <Text className="dim">让 AI 通读当天的时间/待办/收支，写一份小结</Text>}
        {reviewBusy && <Text className="dim">正在通读当天记录…</Text>}
        {review && !reviewBusy && (
          <View>
            <Text className="review-summary">{review.summary}</Text>
            {(review.highlights ?? []).map((h, i) => (
              <View key={`h${i}`} className="review-line">
                <Text className="review-dot ok">●</Text>
                <Text className="grow">{h}</Text>
              </View>
            ))}
            {(review.suggestions ?? []).map((s, i) => (
              <View key={`s${i}`} className="review-line">
                <Text className="review-dot tip">💡</Text>
                <Text className="grow">{s}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
