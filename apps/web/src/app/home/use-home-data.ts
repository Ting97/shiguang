"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api";
import { pickReminders, type ReminderContact, type ReminderItem, type ReminderTodo } from "@/lib/reminders";
import type { Activity, Block, FeedMoment, Space, TodoItem, TodoRow } from "@/lib/types";

const FEED_PAGE_SIZE = 10; // 动态流每页条数，「加载更多」按页追加

/**
 * 首页取数 hook（自 page.tsx 原样迁出）：
 * today 聚合 / 动态流 / 空间切换条 / 提醒横幅数据，以及搜索防抖、空间筛选与「加载更多」。
 */
export function useHomeData() {
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
  const [feedTotal, setFeedTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState(""); // 生效中的搜索词（输入防抖后）
  const [loadingMore, setLoadingMore] = useState(false);
  // 空间切换条（REQ-001 R3）：all=全部 / none=未归属 / <id>=某空间
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [_todos, setTodos] = useState<TodoItem[]>([]);
  const [_doneToday, setDoneToday] = useState<TodoRow[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [todayKcal, setTodayKcal] = useState(0);
  const [reminderItems, setReminderItems] = useState<ReminderItem[]>([]);

  const load = useCallback(async (opts?: { limit?: number; query?: string; spaceId?: string }) => {
    // opts 用于「状态尚未生效就要请求」的场景（如发布后清空搜索再刷新）
    const lim = opts?.limit ?? feedLimit;
    const q = opts?.query !== undefined ? opts.query : query;
    const sp = opts?.spaceId ?? spaceFilter;
    const [j, f, rj] = await Promise.all([
      api("/api/today"),
      api(`/api/feed?limit=${lim}${q ? `&q=${encodeURIComponent(q)}` : ""}${sp !== "all" ? `&spaceId=${sp}` : ""}`),
      // W12 提醒横幅：接口失败不打扰主流程
      api("/api/reminders").catch(() => null),
    ]);
    setTodos(j.todos ?? []);
    setDoneToday(j.doneToday ?? []);
    setBlocks(j.blocks ?? []);
    setActivities(j.activities ?? []);
    setTodayKcal(j.todayKcal ?? 0);
    setMoments(f.moments ?? []);
    setFeedTotal(f.total ?? 0);
    setReminderItems(rj ? pickReminders((rj.contacts ?? []) as ReminderContact[], (rj.todos ?? []) as ReminderTodo[]) : []);
  }, [feedLimit, query, spaceFilter]);

  // 空间切换条数据（active 空间；失败静默——切换条隐藏，feed 照常）
  useEffect(() => {
    api("/api/spaces")
      .then((j) => setSpaces(j.spaces.filter((s: Space) => s.status === "active")))
      .catch(() => setSpaces([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索词输入防抖：停顿 400ms 才真正检索
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 「加载更多」追加一页后 moments 更新，复位按钮加载态
  useEffect(() => {
    setLoadingMore(false);
  }, [moments]);

  function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setFeedLimit((l) => l + FEED_PAGE_SIZE);
  }

  /** 发布时清空搜索再刷新（原 publish 内联三行，语义不变） */
  async function resetSearch() {
    setSearchInput("");
    setQuery("");
    await load({ query: "" });
  }

  /** 切换空间筛选：先置 state，再按新空间立即拉取 */
  function changeSpace(id: string) {
    setSpaceFilter(id);
    void load({ spaceId: id });
  }

  return {
    moments,
    feedTotal,
    loadingMore,
    query,
    searchInput,
    setSearchInput,
    spaceFilter,
    spaces,
    blocks,
    activities,
    todayKcal,
    reminderItems,
    load,
    loadMore,
    resetSearch,
    changeSpace,
  };
}
