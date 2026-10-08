/**
 * 关联 TODO·行动区块（= web detail/todo-section.tsx + todo-row.tsx + use-todo-actions 移动端形态）：
 * 添加 todo（＋保存）→ 行列表（勾选 / 标题点击行内编辑 / ✨AI 拆解 / ⋯ 菜单 / 行动子列表 /
 * 添加行动 / 行动详情就地面板）→ 已完成折叠列表（恢复）。
 * 行菜单、「关联已有」浮层、行级空间关联为底部弹层（web 移动端形态）；删除用 Taro.showModal
 * （web 此处保留 window.confirm 的两步确认语义）。
 */
import { useState } from "react";
import { View, Text, Input, Textarea, Button, Picker } from "@tarojs/components";
import LucideIcon from "../../../components/lucide-icon";
import Taro from "@tarojs/taro";
import {
  createTodo,
  decomposeTodo,
  deleteTodo,
  loadTodoView,
  patchTodo,
  type TodoItem,
  type TodoRow,
} from "./api";
import type { SpaceRow } from "../shared";
import { bjDate, bjToday, dueTag, type DueTag } from "../shared";
import { isoToBjInput, bjInputToIso } from "@shiguangri/shared";
import { showToast } from "@/components/toast";
import "./todo-section.scss";

interface Activity {
  id: string;
  name: string;
  icon: string;
}

/** ISO → 北京 {date, time}（datetime-local 等价拆分；空串=未设）——shared isoToBjInput 单源 */
function dueSplit(iso?: string | null): { date: string; time: string } {
  const v = isoToBjInput(iso);
  return { date: v.slice(0, 10), time: v.slice(11, 16) };
}

/** 北京 {date,time} → ISO（shared bjInputToIso 单源）；无日期返回 null */
function dueCompose(date: string, time: string): string | null {
  if (!date) return null;
  // 默认时刻 09:00 与 todo-bits.joinDue / actions-today 全站口径一致（00:00 会落出「零点截止」）
  return bjInputToIso(`${date}T${time || "09:00"}`);
}

/** 子行动进度 n/m（= web childProgress） */
function childProgress(children: TodoRow[]): { n: number; m: number } | null {
  if (children.length === 0) return null;
  return { n: children.filter((c) => c.status === "done").length, m: children.length };
}

export default function TodoSection(opts: {
  spaceId: string;
  todos: TodoItem[];
  doneTodos: TodoItem[];
  activities: Activity[];
  allSpaces: SpaceRow[];
  onChanged: () => void;
  onPickSpace: (todoId: string, target: string | null) => Promise<boolean>;
}) {
  const { spaceId, todos, doneTodos, activities, allSpaces, onChanged, onPickSpace } = opts;
  const [newTodo, setNewTodo] = useState("");
  const [addingTodo, setAddingTodo] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // 手动添加行动草稿（per-todo）
  const [actionDrafts, setActionDrafts] = useState<Record<string, string>>({});
  const [addingAction, setAddingAction] = useState(false);
  // 行操作菜单（⋯ → 底部弹层）
  const [menuRow, setMenuRow] = useState<{ todo: TodoRow; isChild: boolean } | null>(null);
  // 「关联已有」浮层
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<TodoItem[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  // 行级空间关联浮层
  const [pickerRow, setPickerRow] = useState<TodoRow | null>(null);
  // 顶层 todo 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDueTime, setEditDueTime] = useState("");
  const [editActivity, setEditActivity] = useState("other");
  // 行动详情面板（点行动标题展开编辑）
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDueDate, setNoteDueDate] = useState("");
  const [noteDueTime, setNoteDueTime] = useState("");
  const [noteRepeat, setNoteRepeat] = useState(false);
  const [noteDoneCount, setNoteDoneCount] = useState(0);

  /* ---------- 通用提交 ---------- */

  async function patch(id: string, body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusyId(id);
    try {
      await patchTodo(id, body);
      showToast({ type: "ok", text: okText });
      await onChanged();
      return true;
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "网络异常，请稍后重试" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function addTodo() {
    const t = newTodo.trim();
    if (!t || addingTodo) return;
    setAddingTodo(true);
    try {
      await createTodo({ title: t, spaceId });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "添加失败" });
      return;
    } finally {
      setAddingTodo(false);
    }
    setNewTodo("");
    await onChanged();
  }

  function toggle(t: TodoRow) {
    const done = t.status === "done";
    void patch(t.id, done ? { undone: true } : { done: true }, done ? `↩️「${t.title}」已恢复` : `✅「${t.title}」已完成`);
  }

  async function removeTodo(todo: TodoRow) {
    // web 保留原生 confirm 的两步语义 → showModal
    const res = await Taro.showModal({
      title: "删除确认",
      content: `删除「${todo.title}」？\n其下行动会一并删除。`,
      confirmColor: "#f43f5e",
    });
    if (!res.confirm) return;
    try {
      await deleteTodo(todo.id);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "删除失败" });
      return;
    }
    showToast({ type: "ok", text: "已删除" });
    await onChanged();
  }

  /** 未完成行动数（✨ 与菜单据此给「重新生成/追加」显式选择） */
  function pendingCount(t: TodoRow): number {
    const parent = todos.find((x) => x.id === t.id);
    return parent?.children.filter((c) => c.status === "pending").length ?? 0;
  }

  async function decompose(t: { id: string; title: string; isAction: boolean }, mode?: "replace" | "append") {
    const key = t.id;
    setBusyId(key);
    try {
      const j = await decomposeTodo(t.id, mode);
      showToast({ type: "ok", text: `✨ AI 拆出 ${j.actions.length} 个行动${t.isAction ? "，已插入原行动之后" : ""}` });
      await onChanged();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "AI 拆解失败，请稍后重试" });
    } finally {
      setBusyId(null);
    }
  }

  /* ---------- 行内编辑（顶层 todo） ---------- */

  function startEdit(t: TodoRow) {
    const due = dueSplit(t.due_at);
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDueDate(due.date);
    setEditDueTime(due.time);
    setEditActivity(t.activity_id ?? "other"); // "other"=内置「其他」活动（seed 固定 id）
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editTitle.trim()) {
      showToast({ type: "err", text: "标题不能为空" });
      return;
    }
    const ok = await patch(
      editingId,
      { title: editTitle.trim(), dueAt: dueCompose(editDueDate, editDueTime), activityId: editActivity },
      "💾 已保存",
    );
    if (ok) setEditingId(null);
  }

  /* ---------- 行动详情面板 ---------- */

  function openNote(c: TodoRow) {
    const due = dueSplit(c.due_at);
    setNoteOpen(c.id);
    setNoteTitle(c.title);
    setNoteText(c.note ?? "");
    setNoteDueDate(due.date);
    setNoteDueTime(due.time);
    setNoteRepeat(c.repeat_daily);
    setNoteDoneCount(c.repeat_done_count);
  }

  async function saveNote() {
    if (!noteOpen) return;
    if (!noteTitle.trim()) {
      showToast({ type: "err", text: "标题不能为空" });
      return;
    }
    const ok = await patch(
      noteOpen,
      {
        title: noteTitle.trim(),
        note: noteText.trim() ? noteText.trim() : null,
        dueAt: dueCompose(noteDueDate, noteDueTime),
        repeatDaily: noteRepeat,
      },
      "💾 行动已保存",
    );
    if (ok) setNoteOpen(null);
  }

  /* ---------- 添加行动 / 关联已有 ---------- */

  async function addAction(t: TodoRow) {
    const title = (actionDrafts[t.id] ?? "").trim();
    if (!title || addingAction) return;
    setAddingAction(true);
    try {
      await createTodo({ title, parentId: t.id }); // 行动经 parentId 继承空间归属
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "添加失败" });
      return;
    } finally {
      setAddingAction(false);
    }
    setActionDrafts((d) => ({ ...d, [t.id]: "" }));
    showToast({ type: "ok", text: "📌 行动已添加" });
    await onChanged();
  }

  async function openLinkPicker() {
    try {
      const j = await loadTodoView("all");
      setLinkItems((j.todos ?? []).filter((t) => !t.space_id && t.status === "pending"));
      setLinkQuery("");
      setLinkOpen(true);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "加载失败，请稍后再试" });
    }
  }

  async function linkExisting(todoId: string) {
    const ok = await patch(todoId, { spaceId }, "🎯 已关联到本空间");
    if (ok) setLinkItems((list) => list.filter((x) => x.id !== todoId));
  }

  /** due 标签着色（= dueTag.cls） */
  const dueCls = (tone: DueTag["tone"]) => ({ danger: "due-danger", warn: "due-warn", accent: "due-accent", mute: "due-mute" }[tone]);

  function renderCircle(done: boolean, size: "md" | "sm", onTap: () => void, disabled?: boolean) {
    return (
      <View className={`ts-circle ${size} ${done ? "done" : ""}`} onClick={disabled ? undefined : onTap}>
        <LucideIcon name="check" size={done ? (size === "sm" ? 9 : 12) : 12} color="currentColor" />
      </View>
    );
  }

  function renderRow(t: TodoItem) {
    const done = t.status === "done";
    const open = expanded.has(t.id);
    const tag = done ? null : dueTag(t.due_at);
    const cp = childProgress(t.children);
    return (
      <View key={t.id} className="ts-row">
        {editingId === t.id ? (
          /* ---- 行内编辑器（= web TodoEditRow：标题/截止/分类） ---- */
          <View className="ts-edit">
            <Input
              className="ts-edit-title"
              value={editTitle}
              focus
              onInput={(e) => setEditTitle(e.detail.value)}
            />
            <View className="ts-edit-fields">
              <Picker mode="date" value={editDueDate || bjToday()} onChange={(e) => setEditDueDate(e.detail.value)}>
                <View className="ts-edit-field"><Text>{editDueDate || "截止日期"}</Text></View>
              </Picker>
              <Picker mode="time" value={editDueTime || "09:00"} onChange={(e) => setEditDueTime(e.detail.value)}>
                <View className="ts-edit-field"><Text>{editDueTime || "时间"}</Text></View>
              </Picker>
              <Picker
                mode="selector"
                range={activities.map((a) => `${a.icon} ${a.name}`)}
                value={Math.max(0, activities.findIndex((a) => a.id === editActivity))}
                onChange={(e) => setEditActivity(activities[Number(e.detail.value)]?.id ?? "other")}
              >
                <View className="ts-edit-field">
                  <Text>{activities.find((a) => a.id === editActivity)?.name ?? "其他"}</Text>
                </View>
              </Picker>
              {!!editDueDate && (
                <Text className="ts-edit-clear" onClick={() => { setEditDueDate(""); setEditDueTime(""); }}>清时间</Text>
              )}
            </View>
            <View className="ts-edit-foot">
              <Text className="ts-edit-cancel" onClick={() => setEditingId(null)}>取消</Text>
              <Button className="btn-reset ts-edit-save" hoverClass="press" onClick={() => void saveEdit()}>保存</Button>
            </View>
          </View>
        ) : (
          <>
            <View className="ts-line">
              {renderCircle(done, "md", () => toggle(t), busyId === t.id)}
              <Text className={`ts-title ${done ? "done" : ""}`} onClick={() => !done && startEdit(t)}>
                {t.title}
              </Text>
              {cp && <Text className="ts-childnum">{cp.n}/{cp.m}</Text>}
              {tag && <Text className={`ts-due ${dueCls(tag.tone)}`}>{tag.text}</Text>}
              {!done && (
                <View
                  className="ts-ai ico-row"
                  onClick={() => {
                    if (busyId === t.id) return;
                    if (pendingCount(t) > 0) setMenuRow({ todo: t, isChild: false }); // 已有未完成行动 → 菜单给显式选择
                    else void decompose({ id: t.id, title: t.title, isAction: false });
                  }}
                >
                  {busyId === t.id ? (
                    <Text>拆解中…</Text>
                  ) : (
                    <>
                      <LucideIcon name="sparkles" size={11} color="var(--ai)" />
                      <Text>拆解</Text>
                    </>
                  )}
                </View>
              )}
              <View className="ts-more" onClick={() => setMenuRow({ todo: t, isChild: false })}>
                <LucideIcon name="ellipsis" size={13} color="var(--ink-dim)" />
              </View>
              {(t.children.length > 0 || !done) && (
                <View className={`ts-arrow ${open ? "open" : ""}`} onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
                  <LucideIcon name="chevron_down" size={10} color="var(--ink-mute)" />
                </View>
              )}
            </View>
            {/* 行动子列表（= web ml-8 border-l 区域） */}
            {open && (
              <View className="ts-children">
                {t.children.map((c) => {
                  const cDone = c.status === "done";
                  return (
                    <View key={c.id} className="ts-child">
                      {renderCircle(cDone, "sm", () => toggle(c), busyId === c.id)}
                      <Text className={`ts-child-title ${cDone ? "done" : ""}`} onClick={() => (noteOpen === c.id ? setNoteOpen(null) : openNote(c))}>
                        {c.title}
                      </Text>
                      {c.repeat_daily && (
                        <View className="ts-repeat ico-row">
                          <LucideIcon name="repeat" size={10} color="currentColor" />
                          <Text>{c.repeat_done_count > 0 ? `×${c.repeat_done_count}` : "每日"}</Text>
                        </View>
                      )}
                      {!!c.note && (
                        <View className="ts-note-flag">
                          <LucideIcon name="file_text" size={10} color="var(--ink-dim)" />
                        </View>
                      )}
                      <View className="ts-more" onClick={() => setMenuRow({ todo: c, isChild: true })}>
                        <LucideIcon name="ellipsis" size={12} color="var(--ink-dim)" />
                      </View>
                    </View>
                  );
                })}
                {/* 手动添加行动（已完成 todo 不可再加） */}
                {!done && (
                  <View className="ts-add-action">
                    <View className="ts-add-circle" />
                    <Input
                      className="ts-add-action-input"
                      value={actionDrafts[t.id] ?? ""}
                      maxlength={200}
                      placeholder="＋ 添加行动，保存"
                      placeholderClass="input-placeholder"
                      onInput={(e) => setActionDrafts((d) => ({ ...d, [t.id]: e.detail.value }))}
                      onConfirm={() => void addAction(t)}
                    />
                    <Text className="ts-add-ok" onClick={() => void addAction(t)}>＋</Text>
                  </View>
                )}
                {t.children.length === 0 && !done && (
                  <Text
                    className="ts-decompose-entry"
                    onClick={() => busyId !== t.id && void decompose({ id: t.id, title: t.title, isAction: false })}
                  >
                    {busyId === t.id ? "✨ AI 拆解中…" : "✨ 让 AI 拆解为可执行的行动"}
                  </Text>
                )}
              </View>
            )}
            {/* 行动详情面板（= web NotePanel 就地展开；可编辑标题/描述/截止/每日重复） */}
            {noteOpen && t.children.some((c) => c.id === noteOpen) && (() => {
              const c = t.children.find((x) => x.id === noteOpen)!;
              return (
                <View className="ts-note">
                  <Input className="ts-note-title" value={noteTitle} focus onInput={(e) => setNoteTitle(e.detail.value)} />
                  <Textarea
                    className="ts-note-text"
                    value={noteText}
                    maxlength={1000}
                    placeholder="详细内容（可选，≤1000 字）"
                    placeholderClass="input-placeholder"
                    onInput={(e) => setNoteText(e.detail.value)}
                  />
                  <View className="ts-note-fields">
                    <Text className="ts-note-count">{noteText.length}/1000</Text>
                    <Picker mode="date" value={noteDueDate || bjToday()} onChange={(e) => setNoteDueDate(e.detail.value)}>
                      <View className="ts-note-field"><Text>{noteDueDate || "截止日期"}</Text></View>
                    </Picker>
                    <Picker mode="time" value={noteDueTime || "09:00"} onChange={(e) => setNoteDueTime(e.detail.value)}>
                      <View className="ts-note-field"><Text>{noteDueTime || "时间"}</Text></View>
                    </Picker>
                    <Text
                      className={`ts-note-repeat ${noteRepeat ? "on" : ""}`}
                      onClick={() => setNoteRepeat((v) => !v)}
                    >
                      🔁 每日{noteRepeat && noteDoneCount > 0 ? ` · ×${noteDoneCount}` : ""}
                    </Text>
                  </View>
                  <View className="ts-edit-foot">
                    <Text className="ts-edit-cancel" onClick={() => setNoteOpen(null)}>取消</Text>
                    <Button className="btn-reset ts-edit-save" hoverClass="press" onClick={() => void saveNote()}>保存</Button>
                  </View>
                </View>
              );
            })()}
          </>
        )}
      </View>
    );
  }

  const q = linkQuery.trim().toLowerCase();
  const shown = linkItems.filter((t) => !q || t.title.toLowerCase().includes(q));

  return (
    <View className="glass glass-p5 ts-section">
      {/* 区头（= TagChip 📋 TODO·行动 + 计数 + 关联已有入口） */}
      <View className="ts-head">
        <View className="ts-chip sky ico-row">
          <LucideIcon name="list_todo" size={11} color="currentColor" />
          <Text>TODO·行动</Text>
        </View>
        <Text className="ts-count">{todos.length} 条</Text>
        <View className="ts-link-btn ico-row" onClick={() => void openLinkPicker()}>
          <LucideIcon name="link_2" size={11} color="var(--accent)" />
          <Text>关联已有</Text>
        </View>
      </View>
      {/* 添加 todo（虚线框输入） */}
      <View className="ts-add">
        <Text className="ts-add-plus">＋</Text>
        <Input
          className="ts-add-input"
          value={newTodo}
          maxlength={200}
          placeholder="添加服务于该空间的 TODO"
          placeholderClass="input-placeholder"
          onInput={(e) => setNewTodo(e.detail.value)}
          onConfirm={() => void addTodo()}
        />
        <Text className="ts-add-ok" onClick={() => void addTodo()}>保存</Text>
      </View>

      {todos.length === 0 ? (
        <Text className="ts-empty">
          还没有 TODO/行动 —— 在上面添加、用「关联已有」归属未关联的，或在「日程 · todo」里选择该空间
        </Text>
      ) : (
        <View className="ts-list">{todos.map(renderRow)}</View>
      )}

      {/* 已完成（默认收起，可展开查看/恢复） */}
      {doneTodos.length > 0 && (
        <View className="ts-done">
          <View className="ts-done-summary ico-row" onClick={() => setShowDone((v) => !v)}>
            <LucideIcon name={showDone ? "chevron_down" : "chevron_right"} size={11} color="var(--ink-dim)" />
            <LucideIcon name="check" size={11} color="var(--success)" />
            <Text>已完成（{doneTodos.length}）</Text>
          </View>
          {showDone &&
            doneTodos.map((t) => {
              const cp = childProgress(t.children);
              return (
                <View key={t.id} className="ts-done-row">
                  <View className="ts-done-check">
                    <LucideIcon name="check" size={9} color="#fff" />
                  </View>
                  <Text className="ts-done-title">{t.title}</Text>
                  {cp && <Text className="ts-childnum">{cp.n}/{cp.m}</Text>}
                  {!!t.done_at && <Text className="ts-done-at">{bjDate(t.done_at).slice(5)} 完成</Text>}
                  <View className="ts-done-restore" onClick={() => void patch(t.id, { undone: true }, `↩️「${t.title}」已恢复`)}>
                    <LucideIcon name="rotate_ccw" size={12} color="var(--ink-dim)" />
                  </View>
                </View>
              );
            })}
        </View>
      )}

      {/* 行操作菜单（⋯ → 底部弹层；= web RowMenuModal 移动端形态） */}
      {menuRow && <View className="overlay" onClick={() => setMenuRow(null)} />}
      {menuRow && (
        <View className="sheet ts-menu-sheet safe-bottom">
          <View className="ts-menu-handle" />
          <Text className="ts-menu-title">{menuRow.todo.title}</Text>
          {menuRow.isChild ? (
            <>
              <View
                className="ts-menu-item"
                onClick={() => {
                  const c = menuRow.todo;
                  setMenuRow(null);
                  openNote(c);
                }}
              >
                <View className="ts-menu-icon">
                  <LucideIcon name="pencil" size={13} color="var(--accent)" />
                </View>
                <Text className="ts-menu-text">编辑标题 / 描述</Text>
              </View>
              {menuRow.todo.status !== "done" && (
                <View
                  className="ts-menu-item"
                  onClick={() => {
                    const c = menuRow.todo;
                    setMenuRow(null);
                    void decompose({ id: c.id, title: c.title, isAction: true });
                  }}
                >
                  <View className="ts-menu-icon">
                  <LucideIcon name="sparkles" size={13} color="var(--ai)" />
                </View>
                  <View className="ts-menu-text">
                    <Text>AI 细化为更小行动</Text>
                    <Text className="ts-menu-sub">插入到该行动之后</Text>
                  </View>
                </View>
              )}
              <View
                className="ts-menu-item danger"
                onClick={() => {
                  const c = menuRow.todo;
                  setMenuRow(null);
                  void removeTodo(c);
                }}
              >
                <View className="ts-menu-icon">
                  <LucideIcon name="trash_2" size={13} color="var(--danger)" />
                </View>
                <Text className="ts-menu-text">删除行动</Text>
              </View>
            </>
          ) : (
            <>
              <View
                className="ts-menu-item"
                onClick={() => {
                  const t = menuRow.todo;
                  setMenuRow(null);
                  startEdit(t);
                }}
              >
                <View className="ts-menu-icon">
                  <LucideIcon name="pencil" size={13} color="var(--accent)" />
                </View>
                <Text className="ts-menu-text">编辑标题与时间</Text>
              </View>
              <View
                className="ts-menu-item"
                onClick={() => {
                  const t = menuRow.todo;
                  setMenuRow(null);
                  setPickerRow(t);
                }}
              >
                <View className="ts-menu-icon">
                  <LucideIcon name="target" size={13} color="var(--accent)" />
                </View>
                <Text className="ts-menu-text">关联空间</Text>
              </View>
              {menuRow.todo.status !== "done" && pendingCount(menuRow.todo) === 0 ? (
                <View
                  className="ts-menu-item"
                  onClick={() => {
                    const t = menuRow.todo;
                    setMenuRow(null);
                    void decompose({ id: t.id, title: t.title, isAction: false });
                  }}
                >
                  <View className="ts-menu-icon">
                  <LucideIcon name="sparkles" size={13} color="var(--ai)" />
                </View>
                  <View className="ts-menu-text">
                    <Text>AI 拆解为可执行的行动</Text>
                    <Text className="ts-menu-sub">拆出 ≤10 个行动</Text>
                  </View>
                </View>
              ) : menuRow.todo.status !== "done" ? (
                /* 已有未完成行动：显式二选一（替代 confirm 的重生成/追加双语义） */
                <>
                  <Text className="ts-menu-hint">已有 {pendingCount(menuRow.todo)} 个未完成行动：</Text>
                  <View
                    className="ts-menu-item"
                    onClick={() => {
                      const t = menuRow.todo;
                      setMenuRow(null);
                      void decompose({ id: t.id, title: t.title, isAction: false }, "replace");
                    }}
                  >
                    <View className="ts-menu-icon">
                  <LucideIcon name="sparkles" size={13} color="var(--ai)" />
                </View>
                    <View className="ts-menu-text">
                      <Text>重新生成</Text>
                      <Text className="ts-menu-sub">清空未完成行动后重拆（已完成保留）</Text>
                    </View>
                  </View>
                  <View
                    className="ts-menu-item"
                    onClick={() => {
                      const t = menuRow.todo;
                      setMenuRow(null);
                      void decompose({ id: t.id, title: t.title, isAction: false }, "append");
                    }}
                  >
                    <View className="ts-menu-icon">
                  <LucideIcon name="plus" size={13} color="var(--ink-mute)" />
                </View>
                    <View className="ts-menu-text">
                      <Text>追加到末尾</Text>
                      <Text className="ts-menu-sub">保留现有行动，新行动接在后面</Text>
                    </View>
                  </View>
                </>
              ) : null}
              <View
                className="ts-menu-item danger"
                onClick={() => {
                  const t = menuRow.todo;
                  setMenuRow(null);
                  void removeTodo(t);
                }}
              >
                <View className="ts-menu-icon">
                  <LucideIcon name="trash_2" size={13} color="var(--danger)" />
                </View>
                <View className="ts-menu-text">
                  <Text>删除 todo</Text>
                  <Text className="ts-menu-sub">其下行动一并删除</Text>
                </View>
              </View>
            </>
          )}
        </View>
      )}

      {/* 关联已有 TODO/行动浮层（= web LinkPickerModal 移动端形态） */}
      {linkOpen && <View className="overlay" onClick={() => setLinkOpen(false)} />}
      {linkOpen && (
        <View className="sheet ts-pick-sheet safe-bottom">
          <View className="ts-pick-head">
            <Text className="ts-pick-title">关联已有 TODO / 行动</Text>
            <Text className="ts-pick-count">{linkItems.length} 条未关联</Text>
          </View>
          <Input
            className="input ts-pick-search"
            value={linkQuery}
            placeholder="搜索标题…"
            placeholderClass="input-placeholder"
            onInput={(e) => setLinkQuery(e.detail.value)}
          />
          <View className="ts-pick-list">
            {shown.map((t) => {
              const tag = dueTag(t.due_at);
              return (
                <View key={t.id} className="ts-pick-item" onClick={() => void linkExisting(t.id)}>
                  <View className="ts-pick-star">
                    <LucideIcon name={t.is_important ? "star" : "circle"} size={11} color={t.is_important ? "var(--warn)" : "var(--ink-faint)"} />
                  </View>
                  <Text className="ts-pick-name">
                    {t.kind === "action" ? "行动 " : ""}{t.title}
                  </Text>
                  {tag && <Text className={`ts-due ${dueCls(tag.tone)}`}>{tag.text}</Text>}
                </View>
              );
            })}
            {shown.length === 0 && (
              <Text className="ts-pick-empty">
                {linkItems.length === 0 ? "没有未关联的 TODO/行动 —— 顶层条目都已归属空间" : "没有匹配的 TODO/行动"}
              </Text>
            )}
          </View>
          <Button className="btn-reset ts-pick-close" hoverClass="press" onClick={() => setLinkOpen(false)}>
            关闭
          </Button>
        </View>
      )}

      {/* 行级空间关联浮层（= web SpacePicker 移动端形态） */}
      {pickerRow && <View className="overlay" onClick={() => setPickerRow(null)} />}
      {pickerRow && (
        <View className="sheet ts-pick-sheet safe-bottom">
          <View className="ts-pick-head">
            <Text className="ts-pick-title">关联到空间</Text>
            <Text className="ts-pick-count">{pickerRow.title}</Text>
          </View>
          <View className="ts-pick-list">
            {allSpaces.filter((s) => s.status === "active").map((s) => (
              <View
                key={s.id}
                className="ts-space-item"
                onClick={() => {
                  const t = pickerRow;
                  setPickerRow(null);
                  void onPickSpace(t.id, s.id);
                }}
              >
                <View className="ts-space-icon" style={{ backgroundColor: `${s.color || "#38bdf8"}26` }}>
                  <Text>{s.icon || "🎯"}</Text>
                </View>
                <Text className="ts-space-name">{s.name}</Text>
                {pickerRow.space_id === s.id && <Text className="ts-space-cur">当前</Text>}
              </View>
            ))}
            {allSpaces.length === 0 && <Text className="ts-pick-empty">暂无其他空间</Text>}
          </View>
          <Button
            className="btn-reset ts-pick-close"
            hoverClass="press"
            onClick={() => {
              const t = pickerRow;
              setPickerRow(null);
              void onPickSpace(t.id, null);
            }}
          >
            移除空间归属
          </Button>
        </View>
      )}
    </View>
  );
}
