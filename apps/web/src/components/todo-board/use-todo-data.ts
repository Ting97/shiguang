"use client";

import { useCallback, useEffect, useState } from "react";
import type { Activity, Space, TodoItem } from "@/lib/types";
import { api } from "@/shared/api";
import type { Msg, View } from "./types";

/**
 * 取数 hook（拆分自 todo-board，行为零变化）：智能列表 todos/counts、活动分类、目标空间、轻提示 msg。
 * - 非 ok → 原 fetch 版置空，api() 版抛 ApiClientError 后 catch 里同样归零/报错提示
 * - msg 定时自动消失（成功 3s / 失败 6s）
 */
export function useTodoData(view: View) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [counts, setCounts] = useState({ today: 0, important: 0, all: 0, done: 0 });
  const [activities, setActivities] = useState<Activity[]>([]);
  // 空间列表（添加行展开区选择；REQ-001 R3）
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3000 : 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const loadActivities = useCallback(async () => {
    const j = await api<any>("/api/activities");
    setActivities(j.activities ?? []);
  }, []);
  useEffect(() => {
    loadActivities();
    // 原 fetch 版 !ok → 置空；api() 非 ok 抛 ApiClientError，catch 里同样归零
    api<any>("/api/spaces")
      .then((j) => setSpaces(j.spaces.filter((s: Space) => s.status === "active")))
      .catch(() => setSpaces([]));
  }, [loadActivities]);

  const load = useCallback(async (v: View) => {
    setLoading(true);
    try {
      const j = await api<any>(`/api/todos?view=${v}`);
      setTodos(j.todos ?? []);
      setCounts(j.counts ?? { today: 0, important: 0, all: 0, done: 0 });
    } catch (e) {
      setMsg({ ok: false, text: `加载失败：${e instanceof Error ? e.message : e}` });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(view);
  }, [view, load]);

  return { todos, counts, activities, spaces, loading, msg, setMsg, load };
}

export type TodoData = ReturnType<typeof useTodoData>;
