"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/shared/api";
import { pickReminders, type ReminderContact, type ReminderItem, type ReminderTodo } from "@/lib/reminders";
import type { Activity, Block, FeedMoment, Space, TodoItem, TodoRow } from "@/lib/types";

const FEED_PAGE_SIZE = 10; // 动态流每页条数，「加载更多」按页追加

/**
 * 首页取数 hook（自 page.tsx 原样迁出）：
 * today 聚合 / 动态流 / 空间切换条 / 提醒横幅数据，以及搜索防抖、空间筛选与「加载更多」。
 * @param opts.notify 加载失败时的页面提示回调（如 setMsg）；失败仍以 loadErr + 重试按钮为主
 */
export function useHomeData(opts?: { notify?: (text: string) => void }) {
  const notifyError = opts?.notify;
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState(""); // 生效中的搜索词（输入防抖后）
  const [loadingMore, setLoadingMore] = useState(false);
  // 「加载更多」页数不参与渲染，走 ref：feedLimit 若为 state 会在 loadMore 时再触发一次 effect 造成重复请求
  const feedLimitRef = useRef(FEED_PAGE_SIZE);
  // 取数竞态守卫（对齐 daily/equity-section 的 let live 范式 + 请求序号 ref）：
  // 仅「最新一次 load」的响应可落地——响应回来时若组件已卸载（alive=false）或序号已过期则丢弃 setState
  const seqRef = useRef(0);
  const aliveRef = useRef(true);
  // 加载失败态（网络抖动/接口异常）：给出重试入口，避免失败后整页静默空态
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 空间切换条（REQ-001 R3）：all=全部 / none=未归属 / <id>=某空间
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [_todos, setTodos] = useState<TodoItem[]>([]);
  const [_doneToday, setDoneToday] = useState<TodoRow[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [todayKcal, setTodayKcal] = useState(0);
  const [reminderItems, setReminderItems] = useState<ReminderItem[]>([]);

  // 历史回看锚点（before，ISO 时刻）：跳转「某天最后一条」时置位；null=最新模式。
  // ref 供 loadMore/延迟刷新延续当前锚点，state 供横幅展示
  const beforeRef = useRef<string | null>(null);
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);

  const load = useCallback(async (opts?: { limit?: number; query?: string; spaceId?: string; before?: string | null }): Promise<boolean> => {
    // opts 用于「状态尚未生效就要请求」的场景（如发布后清空搜索再刷新）
    const seq = ++seqRef.current;
    const lim = opts?.limit ?? feedLimitRef.current;
    const q = opts?.query !== undefined ? opts.query : query;
    const sp = opts?.spaceId ?? spaceFilter;
    const bf = opts?.before !== undefined ? opts.before : beforeRef.current;
    setLoadErr(null);
    try {
      const [j, f, rj] = await Promise.all([
        api("/api/today"),
        api(`/api/feed?limit=${lim}${q ? `&q=${encodeURIComponent(q)}` : ""}${sp !== "all" ? `&spaceId=${sp}` : ""}${bf ? `&before=${encodeURIComponent(bf)}` : ""}`),
        // W12 提醒横幅：接口失败不打扰主流程
        api("/api/reminders").catch(() => null),
      ]);
      // 已卸载或已有更新的请求发出：丢弃过期响应，避免旧数据覆盖新视图（连续快切空间场景）
      if (!aliveRef.current || seq !== seqRef.current) return false;
      beforeRef.current = bf ?? null;
      setHistoryBefore(bf ?? null);
      setTodos(j.todos ?? []);
      setDoneToday(j.doneToday ?? []);
      setBlocks(j.blocks ?? []);
      setActivities(j.activities ?? []);
      setTodayKcal(j.todayKcal ?? 0);
      setMoments(f.moments ?? []);
      setFeedTotal(f.total ?? 0);
      setReminderItems(rj ? pickReminders((rj.contacts ?? []) as ReminderContact[], (rj.todos ?? []) as ReminderTodo[]) : []);
      return true;
    } catch (e) {
      if (!aliveRef.current || seq !== seqRef.current) return false;
      // 失败不停在静默空态：置 loadErr（页面展示错误 + 重试按钮）；不向上抛，调用方多为 fire-and-forget
      setLoadErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      // 本次取数周期落幕即复位「加载更多」；若已被更新的请求取代，则由那个周期的 finally 负责复位
      if (aliveRef.current && seq === seqRef.current) setLoadingMore(false);
    }
  }, [query, spaceFilter]);

  // 空间切换条数据（active 空间；失败静默——切换条隐藏，feed 照常）
  useEffect(() => {
    api("/api/spaces")
      .then((j) => setSpaces(j.spaces.filter((s: Space) => s.status === "active")))
      .catch(() => setSpaces([]));
  }, []);

  // 卸载标记的翻转：卸载后一切晚到响应作废（StrictMode 重挂载时恢复 true）
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 新搜索/新空间筛选从最新开始：历史回看锚点一并重置（先于下方 load-effect 声明，同轮取数即生效）
  useEffect(() => {
    beforeRef.current = null;
    setHistoryBefore(null);
  }, [query, spaceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索词输入防抖：停顿 400ms 才真正检索
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  /** 「加载更多」：显式再拉一页（页数走 ref，不再借道 state 触发 effect 造成重复请求）；
   *  try/finally 保证失败时按钮加载态必复位（原实现只在 moments 变化时复位，失败会永久卡 true） */
  const loadingMoreRef = useRef(false);

  async function loadMore() {
    // 双守卫：state 守卫给渲染层（按钮 disabled），ref 守卫拦同一事件循环的双击
    //（setState 要等重渲染才生效，同步两次调用都能穿过旧版单守卫，重复拉一页）
    if (loadingMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    feedLimitRef.current += FEED_PAGE_SIZE;
    try {
      const ok = await load();
      if (!ok) notifyError?.("加载更多失败，请稍后重试");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  /** 发布时清空搜索再刷新：只置状态——setQuery("") 让 load 换引用、effect 自动拉取一次，
   *  原先「置状态后再手动 load({query:""})」会同一参数连发两批请求（changeSpace 同型问题的漏改点） */
  async function resetSearch() {
    setSearchInput("");
    setQuery("");
  }

  /** 切换空间筛选：仅置状态，由 effect 随 spaceFilter 变化自动拉取一次——
   *  原先「先置 state 再手动 load」会让同一筛选连发两批重复请求，快切时旧响应还可能覆盖新数据 */
  function changeSpace(id: string) {
    setSpaceFilter(id);
  }

  return {
    moments,
    feedTotal,
    loadingMore,
    loadErr,
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
    historyBefore,
    changeSpace,
  };
}
