/**
 * 今日行动清单（= web components/actions-today.tsx）：
 * - 展示行动级条目：每日重复 ∪ 独立行动今日/今日到期 ∪ 有父行动随父待办今日（服务端 /api/todos?view=today-actions 过滤）
 * - 顶部「添加行动」输入行：回车/按钮即建独立行动（默认标记今日）
 * - 打卡（done/undone）、两步删除、行内编辑（标题+截止）
 * - 数据自取（= web ActionsToday 自取，不走页面聚合接口）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Input, Picker } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { showToast } from "@/components/toast";
import { createTodo, deleteTodo, loadTodayActions, patchTodo, type TodayActionRow } from "./api";
import LucideIcon from "../../components/lucide-icon";
import { bjInputToIso, dueTag, isoToBjInput } from "./kit";

/** 到期/截止 → 北京墙上串两段（微信 Picker 无 datetime-local，date+time 双 Picker 承载） */
function splitDue(iso: string | null): { date: string; time: string } {
  const v = isoToBjInput(iso);
  return { date: v.slice(0, 10), time: v.slice(11, 16) || "09:00" };
}

export default function ActionsToday({ refreshKey = 0 }: { refreshKey?: number }) {
  const [actions, setActions] = useState<TodayActionRow[] | null>(null);
  // 打卡进行中的行动 id：接到对应行按钮 disabled，防连点重复打卡
  const [busyId, setBusyId] = useState<string | null>(null);
  // 添加行动
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("09:00");
  const [editSaving, setEditSaving] = useState(false);
  // 删除两步确认（3 秒超时自动复位，= web useArmConfirm）
  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「今日已完成」折叠（web 用 <details>，小程序用状态开关）
  const [showDone, setShowDone] = useState(false);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const j = await loadTodayActions();
      setActions(j.actions ?? []);
    } catch (e: any) {
      setActions([]);
      showToast({ type: "err", text: `行动清单加载失败：${e?.message ?? e}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 发布后识别联动刷新（= web entry-analyzed 事件）：key 变化重拉（跳过首次挂载）
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    void load();
  }, [refreshKey, load]);

  /** 直接添加独立行动（默认标记今日，当日出现在清单） */
  async function addAction() {
    const t = newTitle.trim();
    if (!t || adding) return;
    setAdding(true);
    try {
      await createTodo({ title: t, kind: "action", today: true });
      setNewTitle("");
      showToast({ type: "ok", text: `⚡ 已添加行动「${t}」` });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "添加失败" });
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(a: TodayActionRow) {
    if (busyId) return;
    const done = a.status === "done";
    setBusyId(a.id);
    try {
      await patchTodo(a.id, done ? { undone: true } : { done: true });
      if (a.repeat_daily && !done) {
        showToast({ type: "ok", text: `🎉 完成「${a.title}」，已坚持 ×${(a.repeat_done_count ?? 0) + 1}` });
      }
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "操作失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function removeAction(a: TodayActionRow) {
    if (armedId !== a.id) {
      // 首点进入待确认态，3 秒内再点同一行才真正删（= web armDelete.arm）
      setArmedId(a.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedId(null), 3000);
      return;
    }
    setArmedId(null);
    try {
      await deleteTodo(a.id);
      showToast({ type: "ok", text: "🗑 行动已删除" });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "删除失败" });
    }
  }

  function startEdit(a: TodayActionRow) {
    setEditingId(a.id);
    setEditTitle(a.title);
    const d = splitDue(a.due_at);
    setEditDate(d.date);
    setEditTime(d.time);
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim() || editSaving) return;
    setEditSaving(true);
    try {
      await patchTodo(editingId, {
        title: editTitle.trim(),
        // editDue 是北京墙上时间串，必须按 +08:00 解析——裸 new Date() 按宿主时区解释，海外设备会存错 N 小时
        dueAt: editDate ? bjInputToIso(`${editDate}T${editTime}`) : null,
      });
      setEditingId(null);
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "保存失败" });
    } finally {
      setEditSaving(false);
    }
  }

  const pending = (actions ?? []).filter((a) => a.status === "pending");
  const done = (actions ?? []).filter((a) => a.status === "done");

  return (
    // = web section.glass.rounded-2xl.p-5#actions
    <View className="at glass glass-p5">
      {/* 标题行 */}
      <View className="at-head">
        <View className="at-head-left">
          <View className="at-logo">
            <LucideIcon name="list_todo" size={10} color="currentColor" />
          </View>
          <Text className="at-title">今日行动</Text>
          {(actions?.length ?? 0) > 0 ? (
            <Text className="at-count">
              {done.length}/{actions!.length} 完成
            </Text>
          ) : null}
        </View>
          <Text className="at-plan" onClick={() => Taro.redirectTo({ url: "/pages/schedule/index" })}>
          规划 →
        </Text>
      </View>

      {actions === null ? (
        <Text className="at-loading">加载中…</Text>
      ) : (
        <>
          {/* 添加行动行（回车即建，默认标记今日） */}
          <View className="at-add">
            <View className="at-add-circle" />
            <Input
              className="at-add-input"
              value={newTitle}
              maxlength={200}
              placeholder="添加行动，回车保存"
              placeholderClass="input-placeholder"
              confirmType="done"
              onConfirm={() => void addAction()}
              onInput={(e) => setNewTitle(e.detail.value)}
            />
            {newTitle.trim() ? (
              <View className={`btn-primary at-add-btn${adding ? " disabled" : ""}`} hoverClass="press" hoverStayTime={80} onTap={() => void addAction()}>
                <Text className="at-add-btn-text">{adding ? "保存中…" : "添加"}</Text>
              </View>
            ) : null}
          </View>

          {pending.length === 0 && done.length === 0 ? (
            <View className="at-empty">
              <Text>今天还没有行动 —— 在上面直接添加一条（自动标记今日 ☀️），或在 todo 里 ✨ 拆解出可执行的行动</Text>
            </View>
          ) : (
            <>
              <View className="at-list">
                {pending.map((a) => {
                  // 到期提示：行动自身优先，父待办兜底（独立行动只有自身 due）
                  const tag = dueTag(a.due_at) ?? dueTag(a.parent_due);
                  const isEditing = editingId === a.id;
                  if (isEditing) {
                    /* 行内编辑：标题 + 截止（date/time 双 Picker） */
                    return (
                      <View key={a.id} className="at-edit">
                        <Input className="at-edit-input" value={editTitle} placeholder="标题" onInput={(e) => setEditTitle(e.detail.value)} />
                        <View className="at-edit-row">
                          <Picker mode="date" value={editDate || ""} onChange={(e) => setEditDate(e.detail.value)}>
                            <View className="at-edit-pick">{editDate || "截止日期(可空)"}</View>
                          </Picker>
                          <Picker mode="time" value={editTime} onChange={(e) => setEditTime(e.detail.value)}>
                            <View className="at-edit-pick">{editTime}</View>
                          </Picker>
                          <View className="at-edit-actions">
                            <Text className="at-edit-cancel" onClick={() => setEditingId(null)}>
                              取消
                            </Text>
                            <Text
                              className={`at-edit-save${!editTitle.trim() || editSaving ? " disabled" : ""}`}
                              onClick={() => void saveEdit()}
                            >
                              {editSaving ? "保存中…" : "保存"}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View key={a.id} className="at-row">
                      {/* 勾选圆圈（= web TodoCircle）：未完成空心圈，完成实心 */}
                      <View
                        className={`at-circle${busyId === a.id ? " at-circle-busy" : ""}`}
                        hoverClass="press"
                        hoverStayTime={80}
                        onClick={() => void toggleDone(a)}
                      >
                        <LucideIcon name="check" size={12} color="currentColor" />
                      </View>
                      <View className="at-main">
                        <View className="at-line">
                          <Text className="at-row-title">{a.title}</Text>
                          {!a.parent_title ? <Text className="at-tag">行动</Text> : null}
                          {a.repeat_daily ? (
                            <View className="at-tag at-tag-repeat ico-row">
                              <LucideIcon name="repeat" size={10} color="currentColor" />
                              <Text>{a.repeat_done_count > 0 ? `×${a.repeat_done_count}` : "每日"}</Text>
                            </View>
                          ) : null}
                          {a.note ? (
                            <View className="at-note-icon">
                              <LucideIcon name="file_text" size={10} color="var(--ink-dim)" />
                            </View>
                          ) : null}
                        </View>
                        {a.parent_title || tag ? (
                          <View className="at-sub">
                            {a.parent_title ? <Text className="at-parent">来自「{a.parent_title}」</Text> : null}
                            {tag ? <Text style={{ color: tag.color }}>{tag.text}</Text> : null}
                          </View>
                        ) : null}
                      </View>
                      <View className="row-actions">
                        <View className="row-action-btn" onClick={() => startEdit(a)}>
                          <LucideIcon name="pencil" size={11} color="var(--accent)" />
                        </View>
                        <View className={`row-action-btn${armedId === a.id ? " row-action-armed" : ""}`} onClick={() => void removeAction(a)}>
                          {armedId === a.id ? "确认删除?" : <LucideIcon name="trash_2" size={11} color="var(--danger)" />}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* 今日已完成（可恢复） */}
              {done.length > 0 ? (
                <View className="at-done">
                  <View className="at-done-toggle ico-row" onClick={() => setShowDone((v) => !v)}>
                    <LucideIcon name={showDone ? "chevron_down" : "chevron_right"} size={12} color="var(--ink-dim)" />
                    <Text>今日已完成 {done.length} 项（可恢复）</Text>
                  </View>
                  {showDone ? (
                    <View className="at-done-list">
                      {done.map((a) => (
                        <View key={a.id} className="at-done-row">
                          <View className="at-done-check">
                            <LucideIcon name="check" size={9} color="#fff" />
                          </View>
                          <Text className="at-done-title">{a.title}</Text>
                          {a.repeat_daily && a.repeat_done_count > 0 ? <Text className="at-done-repeat">×{a.repeat_done_count}</Text> : null}
                          <View className="at-restore" onClick={() => void toggleDone(a)}>
                            <LucideIcon name="rotate_ccw" size={12} color="var(--ink-dim)" />
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </>
      )}
    </View>
  );
}
