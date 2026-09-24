"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TodoRow } from "@/lib/types";
import { useDismiss } from "./dismissable";
import SpacePicker from "./space-picker";
import { AddTodoRow } from "./todo-board/add-todo-row";
import { EMPTY_DRAFT, EMPTY_TEXT } from "./todo-board/kit";
import { RowMenu } from "./todo-board/row-menu";
import { TodoCard } from "./todo-board/todo-card";
import type { Draft, MenuRowInfo, SubtaskCtl, View } from "./todo-board/types";
import { useActionNote } from "./todo-board/use-action-note";
import { useTodoActions } from "./todo-board/use-todo-actions";
import { useTodoData } from "./todo-board/use-todo-data";
import { useTodoEdit } from "./todo-board/use-todo-edit";
import { ViewBar } from "./todo-board/view-bar";

/**
 * TODO 管理视图（微软 To Do 式，日程页 TODO 子页）：
 * - 智能列表：☀️ 今日（手动标记，跨零点自动失效）/ ⭐ 重要 / 📋 全部 / ✓ 已完成
 * - 移动端顶部横滑 chips；PC（lg+）左侧列表栏 + 右侧主列表
 * - 任务树：行动（原子任务）最多一层；标记（今日/重要）只作用于顶层任务，行动随父
 * - REQ-001 R3：行动支持 ✨AI 拆解（插入式）、🔁 每日重复（×N 已完成次数）、关联目标空间
 * 拆分结构：本入口保留状态编排（取数/提交/编辑 hooks），区块渲染在 todo-board/ 子件，行为零变化。
 */
export default function TodoBoard() {
  const [view, setView] = useState<View>("today");
  const { todos, counts, activities, spaces, loading, msg, setMsg, load } = useTodoData(view);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftOpen, setDraftOpen] = useState(false);
  // N3：添加行展开后点空白收起；有未提交标题则轻提示
  const addRowRef = useDismiss<HTMLDivElement>(() => {
    if (!draftOpen) return;
    if (draft.title.trim()) setMsg({ ok: true, text: "已取消，未保存" });
    setDraftOpen(false);
    setDraft((d) => ({ ...EMPTY_DRAFT, activityId: d.activityId }));
  }, draftOpen);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subParentId, setSubParentId] = useState<string | null>(null); // 正在添加子任务的任务
  const [subTitle, setSubTitle] = useState("");
  // 行操作菜单卡片（点「⋯」弹出，带文字标签；桌面锚定浮层 / 移动端底部弹层）
  const [menuRow, setMenuRow] = useState<MenuRowInfo | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // 再点同一行「⋯」应关菜单：pointerdown 已先经 Dismissable 关闭，随后 click 的 openMenu 会把它再打开。
  // 记录最近一次关闭的时刻与所属行，300ms 内同行的紧随 click 视为同一次点击，不再重开。
  const menuClosedRef = useRef<{ at: number; todoId: string } | null>(null);
  // N1 行级空间关联浮层
  const [pickerRow, setPickerRow] = useState<{ id: string; spaceId: string | null } | null>(null);
  const chipRefs = useRef<Record<View, HTMLButtonElement | null>>({} as Record<View, HTMLButtonElement | null>);

  // 视图切换后把激活 chip 滚入视野（窄屏四个 chip 放不下，与顶部导航同款处理）
  // 注意：容器内 smooth 水平滚动在部分内核不生效，用 instant 立即定位
  useEffect(() => {
    chipRefs.current[view]?.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, [view]);

  // 活动分类默认选中「其他」
  useEffect(() => {
    if (!draft.activityId && activities.length > 0) {
      const other = activities.find((a) => a.id === "other") ?? activities[0];
      setDraft((d) => ({ ...d, activityId: other.id }));
    }
  }, [activities, draft.activityId]);

  const { adding, decomposingId, addTodo, patchTodo, toggleDone, decompose, removeTodo, addSubtask, pendingCount } = useTodoActions({
    view,
    todos,
    load,
    setMsg,
    draft,
    setDraft,
    setDraftOpen,
    subTitle,
    setSubTitle,
  });
  const edit = useTodoEdit({ todos, patchTodo, setMsg });
  const note = useActionNote({ patchTodo, setMsg });

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 「⋯」菜单锚点（原行内逻辑原样搬移）：按钮下方 6px，右侧对齐 224 宽浮层；父 330 / 行动 300 视口余量 */
  function openMenu(e: React.MouseEvent, todo: TodoRow, isChild: boolean, parentTitle?: string) {
    const closed = menuClosedRef.current;
    if (closed && closed.todoId === todo.id && Date.now() - closed.at < 300) return; // 刚被本次点击的 pointerdown 关闭：视为关闭操作
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - (isChild ? 300 : 330)), left: Math.max(8, r.right - 224) });
    setMenuRow({ todo, isChild, parentTitle });
  }

  // 行动输入行控制句柄（组装后经 props 传给子区）
  const sub: SubtaskCtl = {
    parentId: subParentId,
    title: subTitle,
    setTitle: setSubTitle,
    open: setSubParentId,
    close: () => setSubParentId(null),
    add: addSubtask,
    setMsg,
  };

  return (
    <div>
      {msg && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 移动端：横滑 chips（lg 以下）；右缘渐隐提示可滑动（隐藏滚动条时唯一的可供性） */}
      <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] lg:hidden">
        <ViewBar vertical={false} view={view} counts={counts} onSelect={setView} chipRefs={chipRefs} />
      </div>

      <div className="lg:grid lg:grid-cols-[190px_1fr] lg:gap-5">
        {/* PC：左侧智能列表栏 */}
        <aside className="hidden lg:block">
          <div className="glass sticky top-20 space-y-1 rounded-2xl p-2">
            <ViewBar vertical view={view} counts={counts} onSelect={setView} />
          </div>
        </aside>

        {/* 主列表 */}
        <div className="min-w-0">
          {/* 添加任务行（已完成视图不显示）；N3：展开后点空白收起，有未提交内容轻提示 */}
          {view !== "done" && (
            <AddTodoRow
              addRowRef={addRowRef}
              draft={draft}
              setDraft={setDraft}
              draftOpen={draftOpen}
              setDraftOpen={setDraftOpen}
              view={view}
              activities={activities}
              spaces={spaces}
              adding={adding}
              onAdd={addTodo}
            />
          )}

          {loading ? (
            <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
          ) : todos.length === 0 ? (
            <div className="empty-state py-8 text-xs">{EMPTY_TEXT[view]}</div>
          ) : (
            <ul className="space-y-1">
              {todos.map((t) => (
                <TodoCard
                  key={t.id}
                  t={t}
                  activities={activities}
                  spaces={spaces}
                  open={expanded.has(t.id)}
                  edit={edit}
                  note={note}
                  sub={sub}
                  onToggleDone={toggleDone}
                  onToggleExpand={toggleExpand}
                  onOpenMenu={openMenu}
                />
              ))}
              {view === "done" && (
                <li className="px-2 pt-3 text-center text-[11px] text-ink-faint">最多显示最近 200 条已完成的顶层 todo</li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* 行操作菜单卡片：点行右侧「⋯」弹出（桌面锚定浮层 / 移动端底部弹层） */}
      {menuRow && (
        <RowMenu
          menuRow={menuRow}
          menuPos={menuPos}
          onClose={() => {
            // menuRow 取的是本次渲染闭包里的值（= 正在打开的行），用于识别"同行再点=关闭"
            menuClosedRef.current = { at: Date.now(), todoId: menuRow?.todo.id ?? "" };
            setMenuRow(null);
          }}
          decomposingId={decomposingId}
          patchTodo={patchTodo}
          decompose={decompose}
          removeTodo={removeTodo}
          pendingCount={pendingCount}
          startEdit={edit.startEdit}
          openNote={note.openNote}
          onPickSpace={(t) => {
            setPickerRow({ id: t.id, spaceId: t.space_id });
            setMenuRow(null);
          }}
          onAddAction={(t) => {
            setSubParentId(t.id);
            setSubTitle("");
            setExpanded((s) => new Set(s).add(t.id));
          }}
        />
      )}
      {pickerRow &&
        createPortal(
          <SpacePicker
            spaces={spaces}
            currentId={pickerRow.spaceId}
            busy={false}
            onPick={async (sid) => {
              setPickerRow(null);
              await patchTodo(pickerRow.id, { spaceId: sid }, "🎯 已关联空间");
            }}
            onRemove={async () => {
              setPickerRow(null);
              await patchTodo(pickerRow.id, { spaceId: null }, "已移除空间归属");
            }}
            onClose={() => setPickerRow(null)}
          />,
          document.body,
        )}
    </div>
  );
}
