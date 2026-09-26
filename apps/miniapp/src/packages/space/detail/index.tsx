import { useState } from "react";
import { View, Text, Textarea, Button } from "@tarojs/components";
import Taro, { usePullDownRefresh, useReachBottom } from "@tarojs/taro";
import { loadSpaces, loadFeed, type FeedMoment } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { loadReflections, addReflection, type ReflectionItem } from "./api";
import "./index.scss";

const PAGE_SIZE = 20;

/** date 列（started_at/target_date）JSON 序列化可能带时区漂移，+8h 归一后取日（对齐 calendar 页 bjDateKey） */
function bjDate(v: unknown): string {
  if (v == null) return "";
  return new Date(new Date(String(v)).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function bjDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(5, 10).replace("-", "/");
}

export default function SpaceDetailPage() {
  const router = Taro.useRouter();
  const id = router.params.id ?? "";

  const [space, setSpace] = useState<Record<string, any> | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [feedDone, setFeedDone] = useState(false);
  const [reflections, setReflections] = useState<ReflectionItem[]>([]);
  const [refTotal, setRefTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh() {
    try {
      // 详情头：/api/spaces/:id 无 GET，从列表里找（web use-space-data 同款做法）；找不到=已删除
      const sj = await loadSpaces();
      const hit = (sj.spaces ?? []).find((s: any) => s.id === id);
      setSpace(hit ?? null);
      setNotFound(!hit);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
    try {
      const r = await loadReflections(id, PAGE_SIZE, 0);
      setReflections(r.items ?? []);
      setRefTotal(r.total ?? 0);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
    try {
      // 关联动态：复用 lib/api 现成 loadFeed 的 spaceId 过滤参数
      const f = await loadFeed(PAGE_SIZE, 0, "", id);
      setMoments(f.moments ?? []);
      setFeedDone((f.moments ?? []).length < PAGE_SIZE);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
  }

  if (!inited && getSessionToken() && id) {
    setInited(true);
    void refresh();
  }

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  // 动态触底翻页（感悟一次拉完，仅动态分页）
  async function loadMoreFeed() {
    if (!getSessionToken() || feedDone || !id) return;
    try {
      const f = await loadFeed(PAGE_SIZE, moments.length, "", id);
      const more = f.moments ?? [];
      setMoments((m) => [...m, ...more]);
      setFeedDone(more.length < PAGE_SIZE);
    } catch {
      /* 静默：下次触底重试 */
    }
  }
  useReachBottom(loadMoreFeed);

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setMsg(null);
    try {
      await addReflection(id, content);
      setDraft("");
      // 201 后重拉列表（带最新 total），比本地 unshift 稳
      const r = await loadReflections(id, PAGE_SIZE, 0);
      setReflections(r.items ?? []);
      setRefTotal(r.total ?? 0);
      Taro.showToast({ title: "已记录感悟", icon: "success" });
    } catch (e: any) {
      setMsg(e?.message ?? "发布失败");
    } finally {
      setSending(false);
    }
  }

  // 无 id（异常入口）时 inited 永远不会置真，与查不到同等处理，避免停在"加载中"
  if (notFound || !id) {
    return (
      <View className="page-pad">
        <View className="card">
          <Text className="dim">空间不存在或已删除</Text>
        </View>
      </View>
    );
  }

  const pct = space?.todo_total ? Math.round(((space.todo_done ?? 0) / space.todo_total) * 100) : null;
  // 与 DB 默认一致用 hex 兜底：色值要拼「+26」做透明底，var(--accent) 拼不出 alpha
  const color = space?.color || "#38bdf8";

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      {/* 详情头 */}
      <View className="card">
        <View className="head-row">
          <View className="head-icon" style={{ backgroundColor: `${color}26` }}>
            <Text>{space?.icon || "🎯"}</Text>
          </View>
          <View className="grow">
            <Text className="head-name">{space?.name ?? "加载中…"}</Text>
            {!!space?.description && <Text className="dim head-desc">{space.description}</Text>}
          </View>
        </View>
        <View className="head-meta">
          {!!space?.started_at && <Text className="dim">{bjDate(space.started_at)} 开始</Text>}
          {!!space?.target_date && <Text className="dim">目标 {bjDate(space.target_date)}</Text>}
          <Text className="dim">
            待办 {space?.todo_done ?? 0}/{space?.todo_total ?? 0} · 动态 {space?.entry_count ?? 0}
          </Text>
        </View>
        {pct != null && (
          <View className="progress-wrap">
            <View className="progress-bar">
              <View className="progress-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
            </View>
            <Text className="dim">{pct}%</Text>
          </View>
        )}
      </View>

      {/* 关联动态 */}
      <View className="card">
        <Text className="h2">空间动态（{moments.length}）</Text>
        {moments.length === 0 && <Text className="dim">还没有该空间的动态</Text>}
        {moments.map((m) => (
          <View key={m.id} className="moment">
            <View className="moment-head">
              <Text className="dim">{bjDay(String(m.created_at))}</Text>
              {!!m.mood && <Text className="dim">{String(m.mood)}</Text>}
            </View>
            <Text className="moment-text">{m.raw_text}</Text>
          </View>
        ))}
        {!feedDone && moments.length > 0 && <Text className="dim">上拉加载更多…</Text>}
      </View>

      {/* 感悟列表 */}
      <View className="card">
        <Text className="h2">感悟（{refTotal}）</Text>
        {reflections.length === 0 && <Text className="dim">还没有感悟 —— 下方写下第一条</Text>}
        {reflections.map((r) => (
          <View key={r.id} className="ref">
            <Text className="ref-text">{r.preview}</Text>
            <Text className="dim">
              {bjDay(String(r.created_at))} · {r.chars} 字{r.edited ? " · 已编辑" : ""}
            </Text>
          </View>
        ))}
        {reflections.length < refTotal && <Text className="dim">仅显示最近 {PAGE_SIZE} 条</Text>}
      </View>

      {/* 底部输入区：fixed 悬挂，占位元素撑出高度避免列表尾被遮 */}
      <View className="composer-space" />
      <View className="composer">
        <Textarea
          className="composer-input"
          value={draft}
          maxlength={2000}
          placeholder="记一条这个空间的感悟…"
          placeholderClass="dim"
          onInput={(e) => setDraft(e.detail.value)}
        />
        <Button
          className={`btn-primary composer-btn ${!draft.trim() || sending ? "disabled" : ""}`}
          disabled={!draft.trim() || sending}
          onClick={send}
        >
          {sending ? "…" : "记录"}
        </Button>
      </View>
    </View>
  );
}
