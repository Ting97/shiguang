"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import FitnessPanel from "@/app/fitness/panel";
import AssistantDock from "@/components/assistant-dock";
import ReflectionEditor from "@/components/reflection-editor";
import SpacePicker from "@/components/space-picker";
import { useSession } from "@/shared/session";
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
  const { id, space, setSpace, setAllSpaces, notFound, todos, doneTodos, moments, momentsTotal, momentsLoadingMore, loadMoreMoments, activities, allSpaces, loadErr, load } = useSpaceData();
  const [msg, setMsg] = useState<Msg>(null);
  // N2：分区 tab；?tab=fitness 深链定位训练栏（/fitness 旧地址跳转、导航入口用）。
  // 初值固定 "todo"，query 在 effect 里解析（schedule/page.tsx 同款）——
  // 惰性初始化读 window.location.search 会让直链首屏与 SSR 输出水合不匹配
  const [tab, setTab] = useState<SpaceTab>("todo");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "fitness") setTab("fitness");
  }, []);
  // 空间操作菜单（⋯ 收纳归档/删除）。「再点关闭」仲裁：菜单开着再点 ⋯，pointerdown 先被
  // Dismissable 关闭，随后的 click 若无 300ms 仲裁会立即重开——菜单永远关不上（十一轮补齐）
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [spaceMenuPos, setSpaceMenuPos] = useState<{ top: number; left: number } | null>(null);
  const spaceMenuClosedRef = useRef(0);
  const openSpaceMenu = (pos: { top: number; left: number } | null) => {
    if (Date.now() - spaceMenuClosedRef.current < 300) return; // 刚被本次点击的 pointerdown 关闭：视为关闭操作
    setSpaceMenuPos(pos); // null=移动端底部弹层形态（内联锚点与 sm: 弹层类四向约束冲突会错位）
    setSpaceMenu(true);
  };

  const mutations = useSpaceMutations({ id, space, setSpace, setAllSpaces, setMsg });
  const todoActions = useTodoActions({ id, todos, load, setMsg });
  const reflection = useReflection({ id, load, setMsg });
  const momentLink = useMomentLink({ id, load, setMsg });
  const { pickerRow, setPickerRow, pickSpace } = todoActions;
  // 训练 tab 联动（REQ-028）：fitness 模块关闭时不渲染入口与面板（?tab=fitness 深链也回退）
  const { user } = useSession();
  const fitnessOn = !user || user.modules.includes("fitness");
  const activeTab: SpaceTab = tab === "fitness" && !fitnessOn ? "todo" : tab;

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
          openSpaceMenu={openSpaceMenu}
        />

        {/* 分区 tab（REQ-002 N2）：TODO·行动 / 感悟 / 动态；内置运动空间首位多一栏「训练」（REQ-018） */}
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {space.kind === "sport" && fitnessOn && <FilterChip label="训练" active={activeTab === "fitness"} onClick={() => setTab("fitness")} />}
          <FilterChip label="TODO·行动" count={todos.length} active={activeTab === "todo"} onClick={() => setTab("todo")} />
          <FilterChip label="感悟" count={space.reflection_count ?? 0} active={activeTab === "reflection"} onClick={() => setTab("reflection")} />
          {/* 动态计数用 feed total（未被 limit=20 封顶）；接口未带 total 时回退 header-card 的 entry_count 保持口径一致 */}
          <FilterChip label="动态" count={momentsTotal ?? space.entry_count ?? 0} active={activeTab === "moments"} onClick={() => setTab("moments")} />
        </div>

        {/* 训练栏（REQ-018）：健身面板整体嵌入——今日/计划/趋势/目标&档案 */}
        {activeTab === "fitness" && space.kind === "sport" && fitnessOn && <FitnessPanel />}

        {/* 关联 TODO·行动 */}
        {activeTab === "todo" && (
          <TodoSection todos={todos} doneTodos={doneTodos} actions={todoActions} activities={activities} setMsg={setMsg} />
        )}

        {/* 感悟（REQ-002 N2） */}
        {activeTab === "reflection" && (
          <ReflectionSection id={id} reflection={reflection} setMsg={setMsg} load={load} />
        )}

        {/* 关联动态 */}
        {activeTab === "moments" && (
          <MomentsSection
            moments={moments}
            total={momentsTotal}
            loadingMore={momentsLoadingMore}
            onLoadMore={loadMoreMoments}
            momentLink={momentLink}
          />
        )}

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
            onClose={() => {
              spaceMenuClosedRef.current = Date.now();
              setSpaceMenu(false);
            }}
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

        {/* 运动教练（REQ-019 FR-C4）：内置运动空间专属助手，只见 fitness 域工具 */}
        {space?.kind === "sport" && <AssistantDock scope="fitness" />}
      </div>
    </main>
  );
}
