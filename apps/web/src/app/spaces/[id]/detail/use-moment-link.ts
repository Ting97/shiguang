"use client";

import { useState } from "react";
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

  /** C1：加载未归属动态（关联动态浮层数据源；offset=-1 表示重查第一页） */
  async function loadUnlinkedMoments(q: string, offset: number) {
    setMomentLoading(true);
    try {
      const j = await api<any>(`/api/feed?spaceId=none&limit=20&offset=${Math.max(0, offset)}${q ? `&q=${encodeURIComponent(q)}` : ""}`, "GET");
      const list = (j.moments as FeedMoment[]) ?? [];
      setMomentTotal(j.total ?? list.length);
      setMomentItems((prev) => (offset <= 0 ? list : [...prev, ...list]));
    } catch (e) {
      // 原 !r.ok 分支的固定提示；网络异常仍同原版上抛
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: "加载失败，请稍后再试" });
        return;
      }
      throw e;
    } finally {
      setMomentLoading(false);
    }
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
      throw e;
    }
    setMomentItems((list) => list.filter((m) => m.id !== momentId));
    setMomentTotal((n) => Math.max(0, n - 1));
    setMsg({ ok: true, text: "🌱 动态已关联到本空间" });
    await load();
  }

  return {
    momentLinkOpen, setMomentLinkOpen,
    momentItems, momentTotal, momentQuery, setMomentQuery, momentLoading,
    loadUnlinkedMoments, openMomentLink, linkMoment,
  };
}

export type MomentLinkActions = ReturnType<typeof useMomentLink>;
