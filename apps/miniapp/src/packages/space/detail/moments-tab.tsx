/**
 * 关联动态分区（= web moments-section.tsx + use-moment-link.ts + moment-link-modal.tsx 移动端形态）：
 * 区头（🌱 相关动态 + 计数 + 🔗 关联动态入口）→ 动态列表（北京时间戳 + 原文三行截断）
 * → 未归属动态池底部弹层（搜索 400ms 防抖 + 点条目关联 + 加载更多 + 关闭）。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import { linkMoment, loadUnlinkedFeed, type SpaceMoment } from "./api";
import { bjStamp } from "../shared";
import "./moments-tab.scss";

export default function MomentsTab(opts: {
  spaceId: string;
  moments: SpaceMoment[];
  onChanged: () => void;
  setMsg: (m: { ok: boolean; text: string } | null) => void;
}) {
  const { spaceId, moments, onChanged, setMsg } = opts;
  // 未归属动态池（关联弹层）
  const [linkOpen, setLinkOpen] = useState(false);
  const [items, setItems] = useState<SpaceMoment[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // seq 守卫：逐字搜索时慢的旧响应可能后到，只让最新请求落地（= web use-moment-link 范式）
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadPool(q: string, offset: number) {
    const seq = ++seqRef.current;
    const append = offset > 0;
    setLoading(true);
    try {
      const j = await loadUnlinkedFeed(20, Math.max(0, offset), q);
      if (seq !== seqRef.current) return;
      const list = j.moments ?? [];
      setTotal(j.total ?? list.length);
      setItems((prev) => (append ? [...prev, ...list] : list));
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      setMsg({ ok: false, text: e?.message ?? "加载失败，请稍后再试" });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  /** 搜索框 400ms 防抖（输入停顿才请求，重查第一页） */
  function onQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void loadPool(q, 0), 400);
  }

  function openPool() {
    setQuery("");
    setItems([]);
    setTotal(0);
    setLinkOpen(true);
    void loadPool("", 0);
  }

  /** 关联到本空间（成功后从池中移除并刷新计数） */
  async function link(id: string) {
    try {
      await linkMoment(id, spaceId);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "关联失败" });
      return;
    }
    setItems((list) => list.filter((m) => m.id !== id));
    setTotal((n) => Math.max(0, n - 1));
    setMsg({ ok: true, text: "🌱 动态已关联到本空间" });
    onChanged();
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <View className="glass glass-p5 mm-section">
      <View className="mm-head">
        <Text className="mm-chip">🌱 相关动态</Text>
        <Text className="mm-count">{moments.length} 条</Text>
        <Text className="mm-link-btn" onClick={openPool}>🔗 关联动态</Text>
      </View>
      {moments.length === 0 ? (
        <Text className="mm-empty">
          还没有归属该空间的动态 —— 发布时 AI 会自动归类，也可在动态卡片菜单手动归属
        </Text>
      ) : (
        <View className="mm-list">
          {moments.map((m) => (
            <View key={m.id} className="mm-item">
              <Text className="mm-time">{bjStamp(String(m.created_at))}</Text>
              <Text className="mm-text">{m.raw_text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 未归属动态池弹层（= MomentLinkModal 移动端底部弹层） */}
      {linkOpen && <View className="overlay" onClick={() => setLinkOpen(false)} />}
      {linkOpen && (
        <View className="sheet mm-pool safe-bottom">
          <View className="mm-pool-head">
            <Text className="mm-pool-title">关联未归属动态</Text>
            <Text className="mm-pool-count">{total} 条未归属</Text>
          </View>
          <Input
            className="input mm-pool-search"
            value={query}
            placeholder="搜索原文关键字…"
            placeholderClass="input-placeholder"
            onInput={(e) => onQueryChange(e.detail.value)}
          />
          <View className="mm-pool-list">
            {items.map((m) => (
              <View key={m.id} className="mm-pool-item" onClick={() => void link(m.id)}>
                <Text className="mm-pool-time">{bjStamp(String(m.created_at))}</Text>
                <Text className="mm-pool-text">{m.raw_text}</Text>
              </View>
            ))}
            {items.length === 0 && !loading && (
              <Text className="mm-pool-empty">
                {query ? "没有匹配的动态" : "没有未归属的动态 —— 全部都已归入空间"}
              </Text>
            )}
            {loading && <Text className="mm-pool-empty">加载中…</Text>}
          </View>
          {items.length < total && (
            <Button
              className="btn-reset mm-pool-more"
              onClick={() => void loadPool(query, items.length)}
            >
              加载更多（还有 {total - items.length} 条）
            </Button>
          )}
          <Button className="btn-reset mm-pool-more" onClick={() => setLinkOpen(false)}>
            关闭
          </Button>
        </View>
      )}
    </View>
  );
}
