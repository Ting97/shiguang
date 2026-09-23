"use client";

import { useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import ReflectionEditor from "@/components/reflection-editor";
import SpacePicker from "@/components/space-picker";
import { FilterChip } from "@/components/tag-chip";
import HeaderCard from "./detail/header-card";
import LinkPickerModal from "./detail/link-picker-modal";
import MomentsSection from "./detail/moments-section";
import MomentLinkModal from "./detail/moment-link-modal";
import ReflectionSection from "./detail/reflection-section";
import RowMenuModal from "./detail/row-menu-modal";
import SpaceMenuModal from "./detail/space-menu-modal";
import TodoSection from "./detail/todo-section";
import type { Msg, SpaceTab } from "./detail/types";
import { useMomentLink } from "./detail/use-moment-link";
import { useReflection } from "./detail/use-reflection";
import { useSpaceData } from "./detail/use-space-data";
import { useSpaceMutations } from "./detail/use-space-mutations";
import { useTodoActions } from "./detail/use-todo-actions";

/**
 * 空间详情（REQ-001 R3）：空间头部（可编辑/归档/删除）→ 进度概览 →
 * 关联待办（含行动列表、✨AI 拆解、添加行动）→ 关联动态流。
 * 区块拆分见 detail/（头卡、todo 区、感悟区、动态区、各浮层；hooks 同目录）。
 */
export default function Detail() {
  const { id, space, setSpace, setAllSpaces, notFound, todos, doneTodos, moments, activities, allSpaces, loadErr, load } = useSpaceData();
  const [msg, setMsg] = useState<Msg>(null);
  // N2：分区 tab
  const [tab, setTab] = useState<SpaceTab>("todo");
  // 空间操作菜单（⋯ 收纳归档/删除）
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [spaceMenuPos, setSpaceMenuPos] = useState<{ top: number; left: number } | null>(null);

  const mutations = useSpaceMutations({ id, space, setSpace, setAllSpaces, setMsg });
  const todoActions = useTodoActions({ id, todos, load, setMsg });
  const reflection = useReflection({ id, load, setMsg });
  const momentLink = useMomentLink({ id, load, setMsg });
  const { pickerRow, setPickerRow, pickSpace } = todoActions;

  if (notFound) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
          <div className="glass mt-10 rounded-2xl p-10 text-center">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 text-sm">空间不存在或已删除</p>
            <Link href="/spaces" className="btn-primary mt-4 inline-block rounded-xl px-5 py-2 text-sm">
              返回目标列表
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!space) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
          {loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button
                onClick={() => {
                  setSpace(null);
                  void load();
                }}
                className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs"
              >
                重试
              </button>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-4xl px-5 pb-16 pt-8">
        {msg && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"}`}>
            {msg.text}
          </div>
        )}

        {/* 空间头部 */}
        <HeaderCard
          id={id}
          space={space}
          onSaveTargetDate={mutations.saveTargetDate}
          setSpace={setSpace}
          setMsg={setMsg}
          setSpaceMenu={setSpaceMenu}
          setSpaceMenuPos={setSpaceMenuPos}
        />

        {/* 分区 tab（REQ-002 N2）：TODO·行动 / 感悟 / 动态 */}
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip label="TODO·行动" count={todos.length} active={tab === "todo"} onClick={() => setTab("todo")} />
          <FilterChip label="感悟" count={space.reflection_count ?? 0} active={tab === "reflection"} onClick={() => setTab("reflection")} />
          <FilterChip label="动态" count={moments.length} active={tab === "moments"} onClick={() => setTab("moments")} />
        </div>

        {/* 关联 TODO·行动 */}
        {tab === "todo" && (
          <TodoSection todos={todos} doneTodos={doneTodos} actions={todoActions} activities={activities} setMsg={setMsg} />
        )}

        {/* 感悟（REQ-002 N2） */}
        {tab === "reflection" && (
          <ReflectionSection id={id} reflection={reflection} setMsg={setMsg} load={load} />
        )}

        {/* 关联动态 */}
        {tab === "moments" && <MomentsSection moments={moments} momentLink={momentLink} />}

        {/* 行操作菜单卡片：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层）；点空白关闭由 useDismiss 处理（N3） */}
        {todoActions.menuRow && (
          <RowMenuModal menuRow={todoActions.menuRow} pos={todoActions.menuPos} actions={todoActions} />
        )}
        {/* 关联已有 TODO/行动浮层（桌面居中 / 移动端底部弹层） */}
        <LinkPickerModal open={todoActions.linkOpen} items={todoActions.linkItems} actions={todoActions} />

        {/* C1 关联动态浮层（桌面居中 / 移动端底部弹层） */}
        <MomentLinkModal open={momentLink.momentLinkOpen} momentLink={momentLink} />

        {/* 空间操作菜单（⋯ 收纳归档/删除；桌面锚定浮层 / 移动端底部弹层） */}
        {spaceMenu && space && (
          <SpaceMenuModal
            space={space}
            pos={spaceMenuPos}
            setSpaceMenu={setSpaceMenu}
            setStatus={mutations.setStatus}
            removeSpace={mutations.removeSpace}
          />
        )}

        {/* N2 感悟编辑器（底部抽屉，N3 点空白取消） */}
        <ReflectionEditor
          open={reflection.editorOpen}
          initial={reflection.editingReflection?.content ?? ""}
          busy={reflection.refEditorBusy}
          notify={setMsg}
          onCancel={() => reflection.setEditorOpen(false)}
          onSave={reflection.saveReflection}
        />

        {/* N1 行级空间关联浮层 */}
        {pickerRow &&
          createPortal(
            <SpacePicker
              spaces={allSpaces}
              currentId={pickerRow.spaceId}
              busy={false}
              onPick={(sid) => void pickSpace(pickerRow.id, sid)}
              onRemove={() => void pickSpace(pickerRow.id, null)}
              onClose={() => setPickerRow(null)}
            />,
            document.body,
          )}
      </div>
    </main>
  );
}
