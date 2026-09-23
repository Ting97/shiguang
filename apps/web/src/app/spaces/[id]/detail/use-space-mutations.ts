"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Space } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import type { Msg } from "./types";

/** 空间级变更（自 detail.tsx 拆出）：目标到期时间就地保存 / 归档·恢复 / 删除 */
export function useSpaceMutations(opts: {
  id: string;
  space: Space | null;
  setSpace: Dispatch<SetStateAction<Space | null>>;
  setAllSpaces: Dispatch<SetStateAction<Space[]>>;
  setMsg: Dispatch<SetStateAction<Msg>>;
}) {
  const { id, space, setSpace, setAllSpaces, setMsg } = opts;

  async function setStatus(status: "active" | "archived") {
    if (!space) return;
    try {
      await api<any>(`/api/spaces/${space.id}`, "PATCH", { status });
    } catch (e) {
      // 原 fetch 版未检查响应：失败也返回列表（此导航非 401 处理，保留）
      if (!(e instanceof ApiClientError)) throw e;
    }
    location.href = "/spaces";
  }

  /** 调整/清除目标到期时间（头部就地编辑；null=清除） */
  async function saveTargetDate(v: string | null): Promise<boolean> {
    try {
      await api<any>(`/api/spaces/${id}`, "PATCH", { targetDate: v });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "保存失败" : e.message });
        return false;
      }
      throw e;
    }
    setSpace((s) => (s ? { ...s, target_date: v } : s));
    setAllSpaces((list) => list.map((x) => (x.id === id ? { ...x, target_date: v } : x)));
    setMsg({ ok: true, text: v ? `⏳ 目标到期时间已调整为 ${v}` : "目标到期时间已清除" });
    return true;
  }

  async function removeSpace() {
    if (!space) return;
    const refN = space.reflection_count ?? 0;
    if (!window.confirm(`删除空间「${space.name}」？\n含 ${refN} 篇感悟（将一并删除）；${space.todo_total ?? 0} 条关联 todo、${space.entry_count ?? 0} 条动态仅解除归属。`)) return;
    try {
      await api<any>(`/api/spaces/${space.id}`, "DELETE");
    } catch (e) {
      // 原 fetch 版未检查响应：失败也返回列表
      if (!(e instanceof ApiClientError)) throw e;
    }
    location.href = "/spaces";
  }

  return { setStatus, saveTargetDate, removeSpace };
}
