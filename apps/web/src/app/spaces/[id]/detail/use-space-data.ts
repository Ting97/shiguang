"use client";

import { useCallback, useEffect, useState } from "react";
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
  // 数据加载失败态（网络抖动/接口异常）：给出重试入口，避免永远停在"加载中"
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 活动分类（编辑器下拉用）
  const [activities, setActivities] = useState<Activity[]>([]);
  // N1：行级空间关联浮层（待办行）的全量空间列表
  const [allSpaces, setAllSpaces] = useState<Space[]>([]);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      // 原 401 分支（location.href = "/login"）已由 shared/api 统一处理
      const sj = await api<any>("/api/spaces", "GET");
      setAllSpaces((sj.spaces as Space[]) ?? []);
      const s = (sj.spaces as Space[]).find((x) => x.id === id);
      if (!s) {
        setNotFound(true);
        return;
      }
      setSpace(s);
      // 该空间的待办（全视图取全部再前端过滤）；原 if (tr.ok) 失败静默跳过，不阻断其余加载
      try {
        const tj = await api<any>("/api/todos?view=all", "GET");
        setTodos((tj.todos as TodoItem[]).filter((t) => t.space_id === id));
      } catch {
        // 原 if (tr.ok)：失败跳过
      }
      // 已完成的关联 todo（done 视图按完成时间倒序）
      try {
        const dj = await api<any>("/api/todos?view=done", "GET");
        setDoneTodos(((dj.todos as TodoItem[]) ?? []).filter((t) => t.space_id === id));
      } catch {
        // 原 if (dr.ok)：失败跳过
      }
      try {
        const fj = await api<any>("/api/feed?limit=20&spaceId=" + id, "GET");
        setMoments(fj.moments as FeedMoment[]);
      } catch {
        // 原 if (fr.ok)：失败跳过
      }
      try {
        const aj = await api<any>("/api/activities", "GET");
        setActivities(aj.activities ?? []);
      } catch {
        // 原 if (ar.ok)：失败跳过
      }
    } catch (e) {
      // 网络抖动/接口异常不能停在加载态（历史 bug：无 catch 时永远"加载中"只能强刷）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  return { id, space, setSpace, setAllSpaces, notFound, todos, doneTodos, moments, activities, allSpaces, loadErr, load };
}

export type SpaceData = ReturnType<typeof useSpaceData>;
