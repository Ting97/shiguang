"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Space } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { confirmDialog } from "@/shared/ui/confirm";
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
      // 失败报错且不跳转（历史 bug：吞掉 ApiClientError 后无条件跳回列表）
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return;
    }
    location.href = "/spaces";
  }

  /** 调整/清除目标到期时间（头部就地编辑；null=清除） */
  async function saveTargetDate(v: string | null): Promise<boolean> {
    try {
      await api<any>(`/api/spaces/${id}`, "PATCH", { targetDate: v });
    } catch (e) {
      // 含网络错误就地消化：外抛会经 unhandledrejection 触发 ChunkErrorReloader 整页刷新
      setMsg({ ok: false, text: e instanceof ApiClientError && e.message !== "操作失败" ? e.message : "网络异常，请稍后重试" });
      return false;
    }
    setSpace((s) => (s ? { ...s, target_date: v } : s));
    setAllSpaces((list) => list.map((x) => (x.id === id ? { ...x, target_date: v } : x)));
    setMsg({ ok: true, text: v ? `⏳ 目标到期时间已调整为 ${v}` : "目标到期时间已清除" });
    return true;
  }

  async function removeSpace() {
    if (!space) return;
    // 确认弹窗（9-B）：独立渲染树单次点击确认——规避 008 实测 portal 菜单内二次点击丢失问题
    const refN = space.reflection_count ?? 0;
    const ok = await confirmDialog({
      title: "删除空间",
      message: `确定删除「${space.name}」？\n含 ${refN} 篇感悟（将一并删除）；${space.todo_total ?? 0} 条关联 todo、${space.entry_count ?? 0} 条动态仅解除归属。`,
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      await api<any>(`/api/spaces/${space.id}`, "DELETE");
    } catch (e) {
      // 失败报错且不跳转（历史 bug：吞掉 ApiClientError 后无条件跳回列表）
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return;
    }
    location.href = "/spaces";
  }

  return { setStatus, saveTargetDate, removeSpace };
}
