/**
 * 顶层 todo 卡片（= web todo-card.tsx + child-area.tsx + action-note-panel.tsx）：
 * 展示行（勾选圈/行动徽标/进度/到期标签/⋯菜单/展开）↔ 行内编辑器 + 行动子区（一层）。
 * 小程序差异（触屏无 hover 的 web 移动端同款行为）：⋯ 常显；子行动标题点击进详情面板。
 * 编辑/详情面板的截止时间用 date+time 双 picker 组合（= web datetime-local）。
 */
import { useEffect, useState } from "react";
import { Input, Picker, Text, Textarea, View } from "@tarojs/components";
import type { Activity, Space, TodoItem, TodoRow } from "./api";
import { childProgress, dueTag, joinDue, splitDue, TodoCircle } from "./todo-bits";
import { showToast } from "@/components/toast";

export interface SubCtl {
  parentId: string | null;
  title: string;
  setTitle: (t: string) => void;
  close: () => void;
  add: (parentId: string) => void;
}

export default function TodoCard({
  t,
  activities,
  spaces,
  open,
  sub,
  editSignal,
  noteSignal,
  onEditConsumed,
  onToggleDone,
  onToggleExpand,
  onOpenMenu,
  patch,
}: {
  t: TodoItem;
  activities: Activity[];
  spaces: Space[];
  open: boolean;
  sub: SubCtl;
  /** 菜单「✏️ 编辑标题与时间」信号：等于本行 id 时进入行内编辑（消费后回调清零） */
  editSignal?: string | null;
  /** 菜单「✏️ 编辑标题 / 描述」信号：等于某行动 id 时展开其详情面板 */
  noteSignal?: string | null;
  onEditConsumed: () => void;
  onToggleDone: (t: TodoRow) => void;
  onToggleExpand: (id: string) => void;
  onOpenMenu: (todo: TodoRow, isChild: boolean, parentTitle?: string) => void;
  patch: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
}) {
  // 已完成的任务不再展示过期/到期标签（截止时间对已完成的任务没有意义）
  const tag = t.status === "done" ? null : dueTag(t.due_at);
  const prog = childProgress(t.children);
  const done = t.status === "done";
  const [edit, setEdit] = useState<
    { title: string; dueDate: string; dueTime: string; activityId: string; saving: boolean } | null
  >(null);
  // 行动详情面板（= web useActionNote）：标题+描述+截止+每日重复
  const [note, setNote] = useState<
    { id: string; title: string; text: string; dueDate: string; dueTime: string; repeat: boolean; doneCount: number; saving: boolean } | null
  >(null);

  function startEdit() {
    const due = splitDue(t.due_at);
    setEdit({ title: t.title, dueDate: due.date, dueTime: due.time, activityId: t.activity_id ?? "other", saving: false });
  }

  // 菜单信号 → 进入行内编辑（消费即清零，避免重复触发）
  useEffect(() => {
    if (editSignal === t.id) {
      startEdit();
      onEditConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal]);

  async function saveEdit() {
    if (!edit || edit.saving) return;
    if (!edit.title.trim()) {
      showToast({ type: "err", text: "标题不能为空" });
      return;
    }
    setEdit({ ...edit, saving: true });
    const ok = await patch(
      t.id,
      { title: edit.title.trim(), dueAt: joinDue(edit.dueDate, edit.dueTime), activityId: edit.activityId },
      "💾 已保存",
    );
    // 失败时不关闭编辑态，保留用户正在编辑的内容
    if (ok) setEdit(null);
    else setEdit((e) => (e ? { ...e, saving: false } : e));
  }

  function openNoteFor(c: TodoRow) {
    const due = splitDue(c.due_at);
    setNote({ id: c.id, title: c.title, text: c.note ?? "", dueDate: due.date, dueTime: due.time, repeat: c.repeat_daily, doneCount: c.repeat_done_count, saving: false });
  }

  // 行动详情信号：noteSignal 命中本卡某行动时展开详情面板
  useEffect(() => {
    if (noteSignal) {
      const c = t.children.find((x) => x.id === noteSignal);
      if (c) openNoteFor(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteSignal]);

  async function saveNote() {
    if (!note || note.saving) return;
    if (!note.title.trim()) {
      showToast({ type: "err", text: "标题不能为空" });
      return;
    }
    setNote({ ...note, saving: true });
    const ok = await patch(
      note.id,
      {
        title: note.title.trim(),
        note: note.text.trim() ? note.text.trim() : null,
        dueAt: joinDue(note.dueDate, note.dueTime),
        repeatDaily: note.repeat,
      },
      "💾 行动已保存",
    );
    if (ok) setNote(null);
    else setNote((n) => (n ? { ...n, saving: false } : n));
  }

  const actMap = new Map(activities.map((a) => [a.id, a]));
  const dueDraft = edit?.dueDate ? `${edit.dueDate}${edit.dueTime ? ` ${edit.dueTime}` : ""}` : "无截止";

  return (
    <View className="todo-card">
      {edit ? (
        /* ---- 行内编辑器（标题/截止/分类） ---- */
        <View className="todo-edit">
          <Input
            className="te-input"
            value={edit.title}
            maxlength={200}
            placeholderClass="input-placeholder"
            onInput={(e) => setEdit({ ...edit, title: e.detail.value })}
            onConfirm={saveEdit}
          />
          <View className="te-row">
            <Picker
              mode="date"
              value={edit.dueDate}
              onChange={(e) => setEdit({ ...edit, dueDate: e.detail.value })}
            >
              <View className="te-picker">
                <Text>{dueDraft}</Text>
              </View>
            </Picker>
            {edit.dueDate && (
              <Picker mode="time" value={edit.dueTime || "09:00"} onChange={(e) => setEdit({ ...edit, dueTime: e.detail.value })}>
                <View className="te-picker">
                  <Text>{edit.dueTime || "09:00"}</Text>
                </View>
              </Picker>
            )}
            {edit.dueDate && (
              <View className="te-clear" onTap={() => setEdit({ ...edit, dueDate: "", dueTime: "" })}>
                ✕
              </View>
            )}
            <Picker
              mode="selector"
              range={activities.map((a) => `${a.icon} ${a.name}`)}
              value={Math.max(0, activities.findIndex((a) => a.id === edit.activityId))}
              onChange={(e) => setEdit({ ...edit, activityId: activities[Number(e.detail.value)]?.id ?? edit.activityId })}
            >
              <View className="te-picker">
                <Text>{(() => {
                  const a = actMap.get(edit.activityId);
                  return a ? `${a.icon} ${a.name}` : "选择分类";
                })()}</Text>
              </View>
            </Picker>
          </View>
          <View className="te-actions">
            <View className="te-btn mute" onTap={() => setEdit(null)}>
              取消
            </View>
            <View className={`te-btn save ${edit.saving ? "disabled" : ""}`} onTap={edit.saving ? undefined : saveEdit}>
              {edit.saving ? "保存中…" : "保存"}
            </View>
          </View>
        </View>
      ) : (
        <>
          <View className="todo-row">
            <TodoCircle done={done} onTap={() => onToggleDone(t)} />
            <View className="todo-title-wrap" hoverClass="press" hoverStayTime={80} onTap={startEdit}>
              <Text className={`todo-title ${done ? "done" : ""}`}>
                {t.kind === "action" && <Text className="todo-action-badge">行动</Text>}
                {t.title}
              </Text>
            </View>
            {/* 行动进度 chip：点击同展开 */}
            {prog && prog.m > 0 && (
              <View className="todo-prog" onTap={() => onToggleExpand(t.id)}>
                {prog.n}/{prog.m}
              </View>
            )}
            {tag && <Text className={`todo-due tone-${tag.tone}`}>{tag.text}</Text>}
            <View className="todo-more" onTap={() => onOpenMenu(t, false)}>
              ⋯
            </View>
            {t.children.length > 0 && (
              <View className={`todo-caret ${open ? "open" : ""}`} onTap={() => onToggleExpand(t.id)}>
                ▼
              </View>
            )}
          </View>
          {/* 子任务区（最多一层） */}
          {open && (
            <View className="child-area">
              {t.children.map((c) => {
                const ctag = c.status === "done" ? null : dueTag(c.due_at);
                const cDone = c.status === "done";
                return (
                  <View key={c.id} className="child-row">
                    {note && note.id === c.id ? (
                      /* ---- 行动详情面板（= web ActionNotePanel） ---- */
                      <View className="note-panel">
                        <Input
                          className="te-input sm"
                          value={note.title}
                          maxlength={200}
                          placeholder="标题"
                          placeholderClass="input-placeholder"
                          onInput={(e) => setNote({ ...note, title: e.detail.value })}
                        />
                        <Textarea
                          className="te-textarea"
                          value={note.text}
                          maxlength={1000}
                          placeholder="详细内容（可选，记录细节/链接/备注，≤1000 字）"
                          placeholderClass="input-placeholder"
                          onInput={(e) => setNote({ ...note, text: e.detail.value.slice(0, 1000) })}
                        />
                        <View className="np-row">
                          <Text className="np-count">{note.text.length}/1000</Text>
                          <Picker mode="date" value={note.dueDate} onChange={(e) => setNote({ ...note, dueDate: e.detail.value })}>
                            <View className="te-picker sm">
                              <Text>{note.dueDate ? `${note.dueDate}${note.dueTime ? ` ${note.dueTime}` : ""}` : "无截止"}</Text>
                            </View>
                          </Picker>
                          {note.dueDate && (
                            <Picker mode="time" value={note.dueTime || "09:00"} onChange={(e) => setNote({ ...note, dueTime: e.detail.value })}>
                              <View className="te-picker sm">
                                <Text>{note.dueTime || "09:00"}</Text>
                              </View>
                            </Picker>
                          )}
                          {/* 🔁 每日重复：完成后次日 06:00 自动恢复未完成并累积次数 */}
                          <View
                            className={`np-repeat ${note.repeat ? "on" : ""}`}
                            onTap={() => setNote({ ...note, repeat: !note.repeat })}
                          >
                            🔁 每日{note.repeat && note.doneCount > 0 ? ` · 已完成 ×${note.doneCount}` : ""}
                          </View>
                        </View>
                        <View className="te-actions">
                          <View className="te-btn mute" onTap={() => setNote(null)}>
                            取消
                          </View>
                          <View
                            className={`te-btn save ${note.saving || !note.title.trim() ? "disabled" : ""}`}
                            onTap={note.saving || !note.title.trim() ? undefined : saveNote}
                          >
                            {note.saving ? "保存中…" : "保存"}
                          </View>
                        </View>
                      </View>
                    ) : (
                      <View className="child-line">
                        <TodoCircle size="sm" done={cDone} onTap={() => onToggleDone(c)} />
                        <View className={`child-title ${cDone ? "done" : ""}`} onTap={() => openNoteFor(c)}>
                          {c.title}
                        </View>
                        {c.note && <Text className="child-note-mark">📄</Text>}
                        {c.repeat_daily && (
                          <Text className="child-repeat">
                            🔁 {c.repeat_done_count > 0 ? `×${c.repeat_done_count}` : ""}
                          </Text>
                        )}
                        {ctag && <Text className={`todo-due sm tone-${ctag.tone}`}>{ctag.text}</Text>}
                        <View className="todo-more sm" onTap={() => onOpenMenu(c, true, t.title)}>
                          ⋯
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
              {/* 添加行动输入行 */}
              {sub.parentId === t.id && (
                <View className="child-add">
                  <View className="child-add-circle" />
                  <Input
                    className="child-add-input"
                    value={sub.title}
                    maxlength={200}
                    focus
                    placeholder="行动，回车添加"
                    placeholderClass="input-placeholder"
                    onInput={(e) => sub.setTitle(e.detail.value)}
                    onConfirm={() => sub.add(t.id)}
                    onBlur={() => {
                      // 键盘收起即"点空白"：有未提交内容提示（web blur 同款）；输入行保留由 ✕ 显式关闭
                      if (sub.title.trim()) showToast({ type: "info", text: "已取消，未保存" });
                    }}
                  />
                  <View className="child-add-close" onTap={() => sub.close()}>
                    ✕
                  </View>
                </View>
              )}
              {t.children.length === 0 && sub.parentId !== t.id && (
                <Text className="child-hint">还没有行动 —— 行右侧「⋯」里添加，或让 AI 拆解</Text>
              )}
              {done && <Text className="child-hint">已完成的 todo 不可再添加行动</Text>}
            </View>
          )}
        </>
      )}
    </View>
  );
}
