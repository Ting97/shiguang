"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Activity, FeedMoment, Space, TodoItem } from "@/lib/types";
import { api } from "@/shared/api";

/**
 * 空间详情核心取数（自 detail.tsx 拆出）：空间 / 关联 todo（未完成 + 已完成）/
 * 动态 / 活动分类 / 全量空间（行级关联浮层用）。
 */

/**
 * 空间详情数据（REQ-001 R3）。
 * 静态导出壳页的水合参数是构建期占位 "__shell__"，此时从真实地址解析 id（同 contacts/[id] 先例）。
 */
export function useSpaceData() {
  const params = useParams<{ id: string }>();
  const id = !params?.id || params.id === "__shell__"
    ? (typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean)[1] ?? "" : "")
    : params.id;
  const [space, setSpace] = useState<Space | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // 已完成的关联 todo（默认收起展示）
  const [doneTodos, setDoneTodos] = useState<TodoItem[]>([]);
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  // 「动态」tab 计数：feed 接口响应的 total（该空间动态总数，count(*) over () 口径）。
  // null=接口未带 total（降级由调用方用 space.entry_count 兜底）
  const [momentsTotal, setMomentsTotal] = useState<number | null>(null);
  // 动态 tab 分页：首页 20 条由 load() 拉，更多走 loadMoreMoments()（offset 追加）
  const [momentsLoadingMore, setMomentsLoadingMore] = useState(false);
  const momentsOffsetRef = useRef(0);
  // 数据加载失败态（网络抖动/接口异常）：给出重试入口，避免永远停在"加载中"
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 活动分类（编辑器下拉用）
  const [activities, setActivities] = useState<Activity[]>([]);
  // N1：行级空间关联浮层（待办行）的全量空间列表
  const [allSpaces, setAllSpaces] = useState<Space[]>([]);
  // seq 守卫：勾选/编辑后的重载进行中再次触发时，只让最新一轮落地（慢的旧响应后到会覆盖新数据）
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const fresh = (apply: () => void) => {
      if (seq === seqRef.current) apply();
    };
    setLoadErr(null);
    try {
      // 原 401 分支（location.href = "/login"）已由 shared/api 统一处理。
      // 五个接口本无依赖，并行取（原串行 await 首屏耗时为五次 RTT 之和）
      const [sj, tj, dj, fj, aj] = await Promise.allSettled([
        api<any>("/api/spaces", "GET"),
        api<any>("/api/todos?view=all", "GET"),
        api<any>("/api/todos?view=done", "GET"),
        api<any>("/api/feed?limit=20&offset=0&spaceId=" + id, "GET"),
        api<any>("/api/activities", "GET"),
      ]);
      if (seq !== seqRef.current) return; // 过期响应丢弃

      // allSettled 永不 reject，catch 不可达：主请求（spaces）失败必须显式落错误态，
      // 否则 space/loadErr 双空 → 页面永远停在"加载中"（与文件头注释承诺的兜底直接矛盾）
      if (sj.status === "rejected") {
        fresh(() => setLoadErr(sj.reason instanceof Error ? sj.reason.message : String(sj.reason)));
        return;
      }
      {
        const spaces = (sj.value.spaces as Space[]) ?? [];
        setAllSpaces(spaces);
        const s = spaces.find((x) => x.id === id);
        if (!s) {
          fresh(() => setNotFound(true));
          return;
        }
        // 命中有效空间时清 notFound：App Router 同段复用组件不卸载，两个详情地址间前进/后退时
        // （从失效空间返回有效空间）旧版无复位路径，页面永久「空间不存在或已删除」直到整页刷新
        fresh(() => {
          setNotFound(false);
          setSpace(s);
        });
      }
      // 该空间的待办（全视图取全部再前端过滤）；失败跳过（原 if (tr.ok) 静默语义保留）
      fresh(() => {
        if (tj.status === "fulfilled") setTodos(((tj.value.todos as TodoItem[]) ?? []).filter((t) => t.space_id === id)); // ?? [] 与 done 视图同口径：畸形 200 不再把已成功的空间加载打成整页失败
        // 已完成的关联 todo（done 视图按完成时间倒序）
        if (dj.status === "fulfilled") setDoneTodos(((dj.value.todos as TodoItem[]) ?? []).filter((t) => t.space_id === id));
        if (fj.status === "fulfilled") {
          // ?? [] 与上方 todos 分支同口径：畸形 200 缺 moments 时静默空态，不让 .length 的 TypeError 打成整页失败
          const fm = ((fj.value.moments as FeedMoment[] | undefined) ?? []);
          setMoments(fm);
          momentsOffsetRef.current = fm.length;
          // total=该空间动态总数（未被 limit 封顶）；畸形 200 无 total 时落 null 走 entry_count 兜底
          setMomentsTotal(typeof fj.value.total === "number" ? fj.value.total : null);
        }
        if (aj.status === "fulfilled") setActivities(aj.value.activities ?? []);
      });
    } catch (e) {
      // 网络抖动/接口异常不能停在加载态（历史 bug：无 catch 时永远"加载中"只能强刷）
      if (seq === seqRef.current) setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  /** 动态 tab「加载更多」：offset 追加；返回是否还有更多（按本页条数判断，少于 20 即到底） */
  const loadMoreMoments = useCallback(async (): Promise<boolean> => {
    if (momentsLoadingMore) return false;
    setMomentsLoadingMore(true);
    const reqOffset = momentsOffsetRef.current; // 请求时快照
    try {
      const j = await api<any>(`/api/feed?limit=20&offset=${reqOffset}&spaceId=${id}`, "GET");
      // 在途期间 load() 已重置列表（offset 已变）：本次响应整体丢弃——旧翻页 append 会同批重复、
      // offset 继续累加会跳段（21~40 条在本会话永久翻不到，十五轮）
      if (momentsOffsetRef.current !== reqOffset) return true; // 允许基于新列表重试
      const batch = (j.moments as FeedMoment[]) ?? [];
      setMoments((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...batch.filter((m) => !seen.has(m.id))];
      });
      momentsOffsetRef.current += batch.length;
      if (typeof j.total === "number") setMomentsTotal(j.total);
      return batch.length >= 20;
    } catch {
      return true; // 失败保留原状，允许重试
    } finally {
      setMomentsLoadingMore(false);
    }
  }, [id, momentsLoadingMore]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  return { id, space, setSpace, setAllSpaces, notFound, todos, doneTodos, moments, momentsTotal, momentsLoadingMore, loadMoreMoments, activities, allSpaces, loadErr, load };
}

export type SpaceData = ReturnType<typeof useSpaceData>;
