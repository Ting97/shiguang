"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FeedMoment } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import type { Msg } from "./types";

/** C1 关联动态浮层（自 detail.tsx 拆出）：浏览未归属动态并关联到本空间 */
export function useMomentLink(opts: { id: string; load: () => Promise<void>; setMsg: Dispatch<SetStateAction<Msg>> }) {
  const { id, load, setMsg } = opts;
  const [momentLinkOpen, setMomentLinkOpen] = useState(false);
  const [momentItems, setMomentItems] = useState<FeedMoment[]>([]);
  const [momentTotal, setMomentTotal] = useState(0);
  const [momentQuery, setMomentQuery] = useState("");
  const [momentLoading, setMomentLoading] = useState(false);
  // seq 守卫：逐字符搜索时慢的旧响应可能后到，只让最新请求落地（同 use-home-data/trades-section 范式）；
  // 翻页 offset 只在查询签名一致时追加，改词后旧翻页结果不再混入新列表
  const seqRef = useRef(0);

  /** C1：加载未归属动态（关联动态浮层数据源；offset=-1 表示重查第一页） */
  async function loadUnlinkedMoments(q: string, offset: number) {
    const seq = ++seqRef.current;
    const append = offset > 0;
    setMomentLoading(true);
    try {
      const j = await api<any>(`/api/feed?spaceId=none&limit=20&offset=${Math.max(0, offset)}${q ? `&q=${encodeURIComponent(q)}` : ""}`, "GET");
      if (seq !== seqRef.current) return; // 过期响应丢弃
      const list = (j.moments as FeedMoment[]) ?? [];
      setMomentTotal(j.total ?? list.length);
      setMomentItems((prev) => (append ? [...prev, ...list] : list));
    } catch (e) {
      if (seq !== seqRef.current) return;
      // 原 !r.ok 分支的固定提示；网络异常也收口为用户可见提示（裸 throw 会触发整页强刷丢状态）
      setMsg({ ok: false, text: e instanceof ApiClientError && e.message !== "操作失败" ? e.message : "加载失败，请稍后再试" });
    } finally {
      if (seq === seqRef.current) setMomentLoading(false);
    }
  }

  /** C1：搜索框 onChange（400ms 防抖，输入停顿才请求；重查第一页） */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onMomentQueryChange(q: string) {
    setMomentQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void loadUnlinkedMoments(q, 0), 400);
  }

  /** C1：打开关联动态浮层（重置搜索与列表） */
  function openMomentLink() {
    setMomentQuery("");
    setMomentItems([]);
    setMomentTotal(0);
    setMomentLinkOpen(true);
    void loadUnlinkedMoments("", 0);
  }

  /** C1：把未归属动态关联到本空间（成功后从浮层移除并刷新计数） */
  async function linkMoment(momentId: string) {
    try {
      await api<any>(`/api/feed/${momentId}`, "PATCH", { spaceId: id });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "关联失败" : e.message });
        return;
      }
      // 网络异常收口（裸 throw → unhandled rejection → ChunkErrorReloader 整页刷新）
      setMsg({ ok: false, text: "网络异常，请稍后重试" });
      return;
    }
    setMomentItems((list) => list.filter((m) => m.id !== momentId));
    setMomentTotal((n) => Math.max(0, n - 1));
    setMsg({ ok: true, text: "🌱 动态已关联到本空间" });
    await load();
  }

  return {
    momentLinkOpen, setMomentLinkOpen,
    momentItems, momentTotal, momentQuery, onMomentQueryChange, momentLoading,
    loadUnlinkedMoments, openMomentLink, linkMoment,
  };
}

export type MomentLinkActions = ReturnType<typeof useMomentLink>;
