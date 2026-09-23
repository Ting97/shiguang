"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api, ApiClientError } from "@/shared/api";
import type { EditingReflection, Msg } from "./types";

/** N2 感悟编辑器状态与提交（自 detail.tsx 拆出）：新建/编辑（编辑前拉全文） */
export function useReflection(opts: { id: string; load: () => Promise<void>; setMsg: Dispatch<SetStateAction<Msg>> }) {
  const { id, load, setMsg } = opts;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingReflection, setEditingReflection] = useState<EditingReflection | null>(null);
  const [refEditorBusy, setRefEditorBusy] = useState(false);
  // FR-4.1：保存成功后 bump，列表组件（SpaceReflections rev prop）立即重拉
  const [rev, setRev] = useState(0);

  /** 写感悟（空白编辑器） */
  function openNew() {
    setEditingReflection(null);
    setEditorOpen(true);
  }

  /** 打开编辑（SpaceReflections onEdit）：打开编辑器前拉取全文 */
  async function openEdit(rid: string) {
    try {
      const j = await api<any>(`/api/spaces/${id}/reflections/${rid}`, "GET");
      setEditingReflection({ id: rid, content: j.reflection.content });
      setEditorOpen(true);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "全文加载失败" : e.message });
      }
    }
  }

  /** N2：保存感悟（新建/编辑） */
  async function saveReflection(content: string): Promise<boolean> {
    setRefEditorBusy(true);
    try {
      const url = editingReflection
        ? `/api/spaces/${id}/reflections/${editingReflection.id}`
        : `/api/spaces/${id}/reflections`;
      await api<any>(url, editingReflection ? "PATCH" : "POST", { content });
      setMsg({ ok: true, text: editingReflection ? "✏️ 感悟已更新" : "📝 感悟已保存" });
      setEditorOpen(false);
      setRev((r) => r + 1); // FR-4.1：列表立即刷新
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "保存失败" : e.message });
        return false;
      }
      throw e;
    } finally {
      setRefEditorBusy(false);
    }
  }

  return { editorOpen, setEditorOpen, editingReflection, refEditorBusy, openNew, openEdit, saveReflection, rev };
}

export type ReflectionActions = ReturnType<typeof useReflection>;
