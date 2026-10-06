/**
 * TODO 管理视图（= web todo-board.tsx，微软 To Do 式，日程页 TODO 子页）：
 * - 智能列表：☀️ 今日（手动标记，跨零点自动失效）/ ⭐ 重要 / 📋 全部 / ✓ 已完成，移动端顶栏横滑 chips；
 * - 添加行行内新增（展开后带 ⭐/☀️/截止/分类/空间）；任务树：行动最多一层；
 * - 行为/文案/错误分支逐行对齐 web useTodoActions / useTodoEdit / useActionNote。
 */
import { useEffect, useRef, useState } from "react";
import { Input, Picker, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import TodoCard from "./todo-card";
import { RowMenu, type MenuRowInfo } from "./row-menu";
import SpacePicker from "./space-picker";
import { joinDue } from "./todo-bits";
import {
  createTodo,
  decomposeTodo,
  deleteTodo,
  loadActivities,
  loadSpaces,
  loadTodosView,
  patchTodo as apiPatchTodo,
  type Activity,
  type Space,
  type TodoItem,
  type TodoRow,
  type TodoView,
} from "./api";
import { ApiError } from "@/lib/request";
import { showToast } from "@/components/toast";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";

/** 智能列表定义（= web kit.VIEWS；图标 = lucide 对应） */
const VIEWS: [TodoView, string, LucideIconName][] = [
  ["today", "今日", "sun"],
  ["important", "重要", "star"],
  ["all", "全部", "list_todo"],
  ["done", "已完成", "check"],
];

/** 各视图空态文案（= web kit.EMPTY_TEXT） */
const EMPTY_TEXT: Record<TodoView, string> = {
  today: "今天还没安排 ☀️ —— 在上面添加 todo（会自动标记今日），或把 ⭐重要 / 📋全部 里的 todo 标为今日",
  important: "还没有重要 todo ⭐ —— 添加时勾选「重要」，或把现有 todo 标为重要",
  all: "暂无 todo —— 在上面添加一个，或在主页随口说一句（AI 会自动识别 todo）",
  done: "还没有已完成的 todo ✓",
};

interface Draft {
  title: string;
  important: boolean;
  today: boolean;
  dueDate: string;
  dueTime: string;
  activityId: string;
  spaceId: string; // ""=不关联空间
}

export default function TodoBoard({ refreshTick = 0 }: { refreshTick?: number }) {
  const [view, setView] = useState<TodoView>("today");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [counts, setCounts] = useState<Record<TodoView, number>>({ today: 0, important: 0, all: 0, done: 0 });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<Draft>({ title: "", important: false, today: false, dueDate: "", dueTime: "", activityId: "", spaceId: "" });
  const [draftOpen, setDraftOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subParentId, setSubParentId] = useState<string | null>(null); // 正在添加子任务的任务
  const [subTitle, setSubTitle] = useState("");
  const [menuRow, setMenuRow] = useState<MenuRowInfo | null>(null);
  const [pickerRow, setPickerRow] = useState<{ id: string; spaceId: string | null } | null>(null);
  // 菜单「✏️」信号：传给对应 TodoCard 打开行内编辑器 / 行动详情面板（消费后清零）
  const [editSignal, setEditSignal] = useState<string | null>(null);
  const [noteSignal, setNoteSignal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [decomposingId, setDecomposingId] = useState<string | null>(null);

  // 分类/空间一次拉取（失败置空，不阻塞列表）
  useEffect(() => {
    loadActivities()
      .then((j) => setActivities(j.activities ?? []))
      .catch(() => setActivities([]));
    loadSpaces()
      .then((j) => setSpaces((j.spaces ?? []).filter((s: Space) => s.status === "active")))
      .catch(() => setSpaces([]));
  }, []);

  // 取数竞态守卫：快速切视图时旧响应后到会覆盖新视图，序号过期即丢弃
  const seqRef = useRef(0);
  const load = async (v: TodoView) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const j = await loadTodosView(v);
      if (seq !== seqRef.current) return;
      setTodos(j.todos ?? []);
      setCounts(j.counts ?? { today: 0, important: 0, all: 0, done: 0 });
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      showToast({ type: "err", text: `加载失败：${e?.message ?? e}` });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(view);
  }, [view]);
  // 页面下拉刷新（面板常驻挂载，按 tick 重拉当前视图）
  useEffect(() => {
    if (refreshTick > 0) void load(view);
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 活动分类默认选中「其他」（= web）
  useEffect(() => {
    if (!draft.activityId && activities.length > 0) {
      const other = activities.find((a) => a.id === "other") ?? activities[0];
      setDraft((d) => ({ ...d, activityId: other.id }));
    }
  }, [activities, draft.activityId]);

  /* ---------- 提交类操作（= web useTodoActions，错误分支逐行对齐） ---------- */

  async function addTodo() {
    const title = draft.title.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const j = await createTodo({
        title,
        activityId: draft.activityId || undefined,
        important: draft.important || view === "important" ? true : undefined,
        today: draft.today || view === "today" ? true : undefined,
        dueAt: draft.dueDate ? joinDue(draft.dueDate, draft.dueTime) ?? undefined : undefined,
        spaceId: draft.spaceId || undefined,
      });
      setDraft((d) => ({ ...d, title: "", important: false, today: false, dueDate: "", dueTime: "", spaceId: "", activityId: d.activityId }));
      setDraftOpen(false);
      showToast({ type: "ok", text: `📌 已添加「${j.todo.title}」` });
      await load(view);
    } catch (e: any) {
      showToast({ type: "err", text: `添加失败：${e?.message ?? e}` });
    } finally {
      setAdding(false);
    }
  }

  async function patchTodo(id: string, body: Record<string, unknown>, okText?: string): Promise<boolean> {
    try {
      await apiPatchTodo(id, body);
    } catch (e: any) {
      // 网络断开等异常收口为提示，不外抛
      showToast({ type: "err", text: e instanceof ApiError ? e.message : "网络异常，请稍后重试" });
      return false;
    }
    if (okText) showToast({ type: "ok", text: okText });
    try {
      await load(view);
    } catch {
      showToast({ type: "err", text: "网络异常，请稍后重试" });
    }
    return true;
  }

  async function toggleDone(t: TodoItem | TodoRow) {
    const done = t.status === "done";
    await patchTodo(t.id, done ? { undone: true } : { done: true }, done ? `↩️ 「${t.title}」已恢复` : `🎉 完成「${t.title}」`);
  }

  /** 未完成行动数（菜单据此给出「重新生成 / 追加」显式选择） */
  function pendingCount(t: { id: string }): number {
    const parent = todos.find((x) => x.id === t.id);
    return parent?.children.filter((c) => c.status === "pending").length ?? 0;
  }

  /** AI 拆解：待办→≤10 行动；行动→≤3 同级细化（插入其后） */
  async function decompose(t: { id: string; title: string }, isAction: boolean, mode?: "replace" | "append") {
    if (decomposingId) return;
    setDecomposingId(t.id);
    try {
      let j: { actions?: unknown[] };
      try {
        j = await decomposeTodo(t.id, mode);
      } catch (e: any) {
        showToast({
          type: "err",
          text: e instanceof ApiError ? (e.message === "操作失败" ? "AI 拆解失败" : e.message) : "网络异常，请稍后重试",
        });
        return;
      }
      showToast({ type: "ok", text: `✨ AI 拆出 ${(j.actions ?? []).length} 个行动${isAction ? "，已插入原行动之后" : ""}` });
      try {
        await load(view);
      } catch {
        showToast({ type: "err", text: "网络异常，请稍后重试" });
      }
    } finally {
      setDecomposingId(null);
    }
  }

  async function removeTodo(t: TodoItem | TodoRow, isChild: boolean) {
    // ⚠ 保留原生确认对话（web 同款 window.confirm）：destructive 操作安全优先
    const hint = isChild ? "" : "其下行动将一并删除。";
    const res = await Taro.showModal({
      title: `删除${isChild ? "行动" : "todo"}？`,
      content: `${hint}「${t.title}」`,
      confirmText: "删除",
      confirmColor: "#f43f5e",
    });
    if (!res.confirm) return;
    try {
      await deleteTodo(t.id);
    } catch (e: any) {
      showToast({
        type: "err",
        text: e instanceof ApiError ? (e.message === "操作失败" ? "删除失败" : e.message) : "网络异常，请稍后重试",
      });
      return;
    }
    showToast({ type: "ok", text: `🗑 已删除「${t.title}」` });
    try {
      await load(view);
    } catch {
      showToast({ type: "err", text: "网络异常，请稍后重试" });
    }
  }

  async function addSubtask(parentId: string) {
    const title = subTitle.trim();
    if (!title || addingSub) return;
    setAddingSub(true);
    try {
      await createTodo({ title, parentId });
    } catch (e: any) {
      showToast({
        type: "err",
        text: e instanceof ApiError ? (e.message === "操作失败" ? "添加失败" : e.message) : "网络异常，请稍后重试",
      });
      setAddingSub(false); // 失败也要复位，否则输入行永久锁死
      return;
    }
    setSubTitle("");
    try {
      await load(view);
    } catch {
      showToast({ type: "err", text: "网络异常，请稍后重试" });
    } finally {
      setAddingSub(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const actIndex = Math.max(0, activities.findIndex((a) => a.id === draft.activityId));
  const spaceIndex = Math.max(0, spaces.findIndex((s) => s.id === draft.spaceId));

  return (
    <View>

      {/* 移动端：横滑 chips（= web lg:hidden 的 ViewBar，右缘渐隐由 scss mask 实现） */}
      <ScrollView className="todo-chips" scrollX enhanced showScrollbar={false}>
        <View className="todo-chips-track">
          {VIEWS.map(([v, label, icon]) => (
            <View
              key={v}
              className={`tb-chip ${view === v ? "active" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => setView(v)}
            >
              <LucideIcon name={icon} size={13} color={view === v ? "#fff" : "var(--ink-mute)"} />
              <Text>{label}</Text>
              <Text className="tb-chip-count">{counts[v] ?? 0}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View>
        {/* 主列表 */}
        <View>
          {/* 添加任务行（已完成视图不显示） */}
          {view !== "done" && (
            <View className="add-row glass">
              <View className="add-row-line">
                <View className="add-circle" />
                <Input
                  className="add-input"
                  value={draft.title}
                  maxlength={200}
                  placeholder="添加 todo，回车保存"
                  placeholderClass="input-placeholder"
                  onFocus={() => setDraftOpen(true)}
                  onInput={(e) => setDraft({ ...draft, title: e.detail.value })}
                  onConfirm={addTodo}
                />
                <View
                  className={`btn-primary add-btn ${!draft.title.trim() || adding ? "disabled" : ""}`}
                  onTap={!draft.title.trim() || adding ? undefined : addTodo}
                >
                  {adding ? "保存中…" : "添加"}
                </View>
              </View>
              {draftOpen && (
                <View className="add-extra">
                  <View
                    className={`add-toggle ico-row ${draft.important ? "star" : ""}`}
                    onTap={() => setDraft({ ...draft, important: !draft.important })}
                  >
                    <LucideIcon name="star" size={12} color="currentColor" />
                    <Text>重要</Text>
                  </View>
                  <View
                    className={`add-toggle ico-row ${draft.today || view === "today" ? "sun" : ""}`}
                    onTap={() => setDraft({ ...draft, today: !draft.today })}
                  >
                    <LucideIcon name="sun" size={12} color="currentColor" />
                    <Text>今日</Text>
                  </View>
                  <Picker mode="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.detail.value })}>
                    <View className="te-picker">
                      <Text>{draft.dueDate ? `${draft.dueDate}${draft.dueTime ? ` ${draft.dueTime}` : ""}` : "截止时间"}</Text>
                    </View>
                  </Picker>
                  {draft.dueDate && (
                    <Picker mode="time" value={draft.dueTime || "09:00"} onChange={(e) => setDraft({ ...draft, dueTime: e.detail.value })}>
                      <View className="te-picker">
                        <Text>{draft.dueTime || "09:00"}</Text>
                      </View>
                    </Picker>
                  )}
                  {draft.dueDate && (
                    <View className="te-clear" onTap={() => setDraft({ ...draft, dueDate: "", dueTime: "" })}>
                      <LucideIcon name="x" size={12} color="currentColor" />
                    </View>
                  )}
                  <Picker
                    mode="selector"
                    range={activities.map((a) => `${a.icon} ${a.name}`)}
                    value={actIndex}
                    onChange={(e) => setDraft({ ...draft, activityId: activities[Number(e.detail.value)]?.id ?? draft.activityId })}
                  >
                    <View className="te-picker">
                      <Text>
                        {(() => {
                          const a = activities.find((x) => x.id === draft.activityId);
                          return a ? `${a.icon} ${a.name}` : "分类";
                        })()}
                      </Text>
                    </View>
                  </Picker>
                  {spaces.length > 0 && (
                    <Picker
                      mode="selector"
                      range={["不关联空间", ...spaces.map((s) => `${s.icon} ${s.name}`)]}
                      value={draft.spaceId ? spaceIndex + 1 : 0}
                      onChange={(e) => {
                        const i = Number(e.detail.value);
                        setDraft({ ...draft, spaceId: i === 0 ? "" : spaces[i - 1]?.id ?? "" });
                      }}
                    >
                      <View className="te-picker">
                        <Text>
                          {(() => {
                            const s = spaces.find((x) => x.id === draft.spaceId);
                            return s ? `${s.icon} ${s.name}` : "🎯 不关联空间";
                          })()}
                        </Text>
                      </View>
                    </Picker>
                  )}
                </View>
              )}
            </View>
          )}

          {loading ? (
            <Text className="tb-loading dim">加载中…</Text>
          ) : todos.length === 0 ? (
            <View className="empty-state">
              <Text>{EMPTY_TEXT[view]}</Text>
            </View>
          ) : (
            <View className="todo-list">
              {todos.map((t) => (
                <TodoCard
                  key={t.id}
                  t={t}
                  activities={activities}
                  spaces={spaces}
                  open={expanded.has(t.id)}
                  sub={{ parentId: subParentId, title: subTitle, setTitle: setSubTitle, close: () => setSubParentId(null), add: addSubtask }}
                  editSignal={editSignal}
                  noteSignal={noteSignal}
                  onEditConsumed={() => setEditSignal(null)}
                  onToggleDone={toggleDone}
                  onToggleExpand={toggleExpand}
                  onOpenMenu={(todo, isChild, parentTitle) => setMenuRow({ todo, isChild, parentTitle })}
                  patch={patchTodo}
                />
              ))}
              {view === "done" && <Text className="todo-done-foot">最多显示最近 200 条已完成的顶层 todo</Text>}
            </View>
          )}
        </View>
      </View>

      {/* 行操作菜单卡片：点行右侧「⋯」弹出（移动端底部弹层） */}
      {menuRow && (
        <RowMenu
          menuRow={menuRow}
          onClose={() => setMenuRow(null)}
          decomposingId={decomposingId}
          patchTodo={patchTodo}
          decompose={decompose}
          removeTodo={removeTodo}
          pendingCount={pendingCount}
          startEdit={(t) => {
            setMenuRow(null);
            setEditSignal(t.id); // 行内编辑器在卡片里，经信号打开
          }}
          openNote={(t) => {
            setMenuRow(null);
            if (t.parent_todo_id) setExpanded((s) => new Set(s).add(t.parent_todo_id!)); // 行动区可能收着，先展开
            setNoteSignal(t.id);
          }}
          onPickSpace={(t) => {
            setPickerRow({ id: t.id, spaceId: t.space_id });
            setMenuRow(null);
          }}
          onAddAction={(t) => {
            setMenuRow(null);
            setSubParentId(t.id);
            setSubTitle("");
            setExpanded((s) => new Set(s).add(t.id));
          }}
        />
      )}
      {pickerRow && (
        <SpacePicker
          spaces={spaces}
          currentId={pickerRow.spaceId}
          onPick={async (sid) => {
            setPickerRow(null);
            await patchTodo(pickerRow.id, { spaceId: sid }, "🎯 已关联空间");
          }}
          onRemove={async () => {
            setPickerRow(null);
            await patchTodo(pickerRow.id, { spaceId: null }, "已移除空间归属");
          }}
          onClose={() => setPickerRow(null)}
        />
      )}
    </View>
  );
}
