"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Ellipsis, Flag, Hourglass, Pencil, Plus, Undo2, X } from "lucide-react";
import { Dismissable } from "@/components/dismissable";
import InlineRename from "@/components/inline-rename";
import { Modal } from "@/components/ui/modal";
import type { Space, SpaceMilestone } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { bjDate, bjToday } from "./kit";
import type { Msg, Pos } from "./types";

/** 阶段目标区（REQ-019 FR-B1）：进行中列表 + 快速新建 + 历史弹层——取代 todo/行动完成率 */
function MilestoneSection({ id, color, setSpace }: { id: string; color: string; setSpace: Dispatch<SetStateAction<Space | null>> }) {
  const [items, setItems] = useState<SpaceMilestone[] | null>(null);
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 行内编辑（REQ-019 追加）：标题 + 目标日期均可改，active 列表与历史弹层共用
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");

  const startEdit = (m: SpaceMilestone) => {
    setEditingId(m.id);
    setEditTitle(m.title);
    setEditDate(m.target_date ? bjDate(m.target_date) : "");
  };

  async function saveEdit(mid: string) {
    const t = editTitle.trim();
    if (!t || busy) return;
    // 失败保持编辑态（输入不丢）：patch 内部 catch 后正常返回，需靠返回值判定——
    // 旧版无条件 setEditingId(null)，网络/400 失败时已输入内容静默丢失（十一轮修）
    if ((await patch(mid, { title: t, targetDate: editDate || null })) === false) return;
    setEditingId(null);
  }

  const load = useCallback(async () => {
    try {
      const r = await api<{ milestones: SpaceMilestone[] }>(`/api/spaces/${id}/milestones`);
      setItems(r.milestones);
    } catch {
      setItems([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 聚合数同步回列表页卡片（active_milestones/done_milestones）
  const syncCounts = (rows: SpaceMilestone[]) => {
    setSpace((s) =>
      s ? { ...s, active_milestones: rows.filter((m) => m.status === "active").length, done_milestones: rows.filter((m) => m.status === "done").length } : s,
    );
  };

  async function create() {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api(`/api/spaces/${id}/milestones`, "POST", { title: t, targetDate: draftDate || null });
      setDraft("");
      setDraftDate("");
      setAdding(false);
      const r = await api<{ milestones: SpaceMilestone[] }>(`/api/spaces/${id}/milestones`);
      setItems(r.milestones);
      syncCounts(r.milestones);
    } catch (e) {
      // 异常收口为失败提示（原 setDraft((v)=>v) 是 no-op，失败零反馈让人以为已保存）
      toast(e instanceof ApiClientError ? e.message : "阶段目标创建失败，请重试", "err");
    } finally {
      setBusy(false);
    }
  }

  /** PATCH 里程碑：成功 true / 失败 false（saveEdit 据此保持编辑态，输入不丢） */
  async function patch(mid: string, body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await api(`/api/spaces/${id}/milestones/${mid}`, "PATCH", body);
      const r = await api<{ milestones: SpaceMilestone[] }>(`/api/spaces/${id}/milestones`);
      setItems(r.milestones);
      syncCounts(r.milestones);
      return true;
    } catch (e) {
      // 标记达成/放弃/编辑失败必须有反馈（网络/400 时保留原列表但要让用户知道没保存）
      toast(e instanceof ApiClientError ? e.message : "操作失败，请重试", "err");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const active = (items ?? []).filter((m) => m.status === "active");
  const doneCount = (items ?? []).filter((m) => m.status === "done").length;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-badge text-ink-faint">阶段目标（完成一个阶段推进一程）</span>
        <span className="flex items-center gap-2 text-badge">
          {(items?.length ?? 0) > 0 && (
            <button className="tap-lg text-ink-mute transition hover:text-accent" onClick={() => setHistoryOpen(true)}>
              历史 {items!.length} · 达成 {doneCount}
            </button>
          )}
          <button className="tap-lg flex items-center gap-0.5 text-accent transition hover:underline" onClick={() => setAdding((v) => !v)}>
            <Plus size={11} aria-hidden /> 阶段
          </button>
        </span>
      </div>

      {adding && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-line-soft bg-surface/70 p-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void create();
            }}
            placeholder="阶段目标（如：完赛首场半马）"
            maxLength={80}
            className="min-w-0 flex-1 rounded-lg border border-line-soft bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
          />
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="rounded-lg border border-line-soft bg-surface px-1.5 py-1 text-xs text-ink outline-none"
            title="目标日期（可空）"
          />
          <button className="btn-primary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50" onClick={create} disabled={busy || !draft.trim()}>
            添加
          </button>
        </div>
      )}

      {items === null ? (
        <p className="text-xs text-ink-faint">加载中…</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {items.length === 0 ? "还没有阶段目标——把大目标拆成一段一段的小里程碑。" : "进行中的阶段已清空，开启下一个阶段吧。"}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {active.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-xl bg-elevated/60 px-2.5 py-1.5">
              {editingId === m.id ? (
                <>
                  <Flag size={12} className="shrink-0" style={{ color }} aria-hidden />
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveEdit(m.id);
                      if (e.key === "Escape" && !e.nativeEvent.isComposing) setEditingId(null);
                    }}
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-lg border border-line-soft bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
                  />
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="shrink-0 rounded-lg border border-line-soft bg-surface px-1.5 py-1 text-xs text-ink outline-none"
                    title="目标日期（可空）"
                  />
                  <button
                    onClick={() => saveEdit(m.id)}
                    disabled={busy || !editTitle.trim()}
                    title="保存"
                    className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-emerald-500/15 hover:text-success disabled:opacity-40"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    title="取消"
                    className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-rose-500/15 hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <Flag size={12} className="shrink-0" style={{ color }} aria-hidden />
                  <button
                    onClick={() => startEdit(m)}
                    title="点击编辑阶段目标"
                    className="min-w-0 flex-1 truncate text-left text-xs text-ink transition hover:text-accent"
                  >
                    {m.title}
                  </button>
                  {m.target_date && (
                    <span className={`shrink-0 text-micro tabular-nums ${bjDate(m.target_date) < bjToday() ? "text-danger" : "text-ink-faint"}`}>
                      {bjDate(m.target_date).slice(5)}
                    </span>
                  )}
                  <button
                    onClick={() => startEdit(m)}
                    title="编辑"
                    className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-soft hover:text-accent"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => patch(m.id, { status: "done" })}
                    title="标记达成"
                    className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-emerald-500/15 hover:text-success"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => patch(m.id, { status: "abandoned" })}
                    title="放弃"
                    className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-rose-500/15 hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {historyOpen && (
        <Modal title="阶段目标历史" onClose={() => setHistoryOpen(false)}>
          <ul className="space-y-2">
            {(items ?? []).map((m) => (
              <li key={m.id} className="rounded-xl border border-line-soft p-2.5">
                {editingId === m.id ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveEdit(m.id);
                        if (e.key === "Escape" && !e.nativeEvent.isComposing) setEditingId(null);
                      }}
                      maxLength={80}
                      className="min-w-0 flex-1 rounded-lg border border-line-soft bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
                    />
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="rounded-lg border border-line-soft bg-surface px-1.5 py-1 text-xs text-ink outline-none"
                      title="目标日期（可空）"
                    />
                    <button
                      onClick={() => saveEdit(m.id)}
                      disabled={busy || !editTitle.trim()}
                      className="btn-primary rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button className="rounded-lg px-2 py-1 text-xs text-ink-mute hover:bg-soft" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          m.status === "done"
                            ? "bg-emerald-500/15 text-success"
                            : m.status === "abandoned"
                              ? "bg-wash text-ink-faint"
                              : "bg-sky-500/15 text-accent"
                        }`}
                      >
                        {m.status === "done" ? "已达成" : m.status === "abandoned" ? "已放弃" : "进行中"}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-xs ${m.status === "active" ? "text-ink" : "text-ink-mute"}`}>{m.title}</span>
                      {m.target_date && <span className="shrink-0 text-micro tabular-nums text-ink-faint">{bjDate(m.target_date).slice(5)}</span>}
                      <button
                        onClick={() => startEdit(m)}
                        title="编辑"
                        className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-soft hover:text-accent"
                      >
                        <Pencil size={12} />
                      </button>
                      {m.status !== "active" ? (
                        <button
                          onClick={() => patch(m.id, { status: "active" })}
                          title="重新开启"
                          className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-sky-500/15 hover:text-accent"
                        >
                          <Undo2 size={13} />
                        </button>
                      ) : null}
                    </div>
                    {m.completed_at && <p className="mt-1 text-micro text-ink-faint">达成于 {bjDate(m.completed_at)}</p>}
                  </>
                )}
              </li>
            ))}
            {(items ?? []).length === 0 && <li className="text-xs text-ink-mute">还没有阶段目标。</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** 空间头部卡（自 detail.tsx 拆出）：图标/重命名/目标到期就地编辑/⋯ 菜单入口/进度概览 */
export default function SpaceHeaderCard(opts: {
  id: string;
  space: Space;
  onSaveTargetDate: (v: string | null) => Promise<boolean>;
  setSpace: Dispatch<SetStateAction<Space | null>>;
  setMsg: Dispatch<SetStateAction<Msg>>;
  /** 打开 ⋯ 菜单（detail.tsx 携带「再点关闭」仲裁：菜单开着再点 ⋯，pointerdown 先关、
   *  click 不再重开——直接传 setSpaceMenu 会关不上，十一轮补齐同 todo-board） */
  openSpaceMenu: (pos: Pos | null) => void;
}) {
  const { id, space, onSaveTargetDate, setSpace, setMsg, openSpaceMenu } = opts;
  // 目标到期时间就地编辑（头部 ⏳ 日期可点击调整/清除）
  const [dateEdit, setDateEdit] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const days = space.started_at ? Math.max(1, Math.ceil((Date.now() - new Date(bjDate(space.started_at) + "T00:00:00+08:00").getTime()) / 86_400_000)) : null;

  return (
    <div className="glass mb-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl" style={{ backgroundColor: `${space.color}26` }}>
          {space.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">
            <InlineRename
              value={space.name}
              onSave={async (name) => {
                try {
                  await api<any>(`/api/spaces/${id}`, "PATCH", { name });
                } catch (e) {
                  if (e instanceof ApiClientError) {
                    setMsg({ ok: false, text: e.message === "操作失败" ? "重命名失败" : e.message });
                    return false;
                  }
                  // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
                  setMsg({ ok: false, text: "网络异常，请稍后重试" });
                  return false;
                }
                setSpace({ ...space, name });
                setMsg({ ok: true, text: "已重命名" });
                return true;
              }}
            />
          </h1>
          {space.description && <p className="mt-1 text-xs leading-relaxed text-ink-mute">{space.description}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-dim">
            {space.started_at && <span>{bjDate(space.started_at)} 开始</span>}
            {dateEdit ? (
              <Dismissable onClose={() => setDateEdit(false)} className="inline-flex items-center gap-1.5">
                <input
                  type="date"
                  autoFocus
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  className="rounded-lg border border-sky-500/50 bg-elevated px-1.5 py-0.5 text-micro text-ink"
                />
                <button
                  onClick={async () => {
                    if (await onSaveTargetDate(dateDraft || null)) setDateEdit(false);
                  }}
                  className="rounded-lg bg-sky-500/20 px-1.5 py-0.5 text-accent transition hover:bg-sky-500/30"
                >
                  保存
                </button>
                {space.target_date && (
                  <button
                    onClick={async () => {
                      if (await onSaveTargetDate(null)) setDateEdit(false);
                    }}
                    className="rounded-lg px-1.5 py-0.5 text-ink-mute transition hover:bg-soft hover:text-danger"
                  >
                    清除
                  </button>
                )}
              </Dismissable>
            ) : (
              <button
                onClick={() => {
                  setDateDraft(space.target_date ? bjDate(space.target_date) : "");
                  setDateEdit(true);
                }}
                className="-mx-1 rounded px-1 text-left transition hover:bg-soft hover:text-accent"
                title={space.target_date ? "点击调整目标到期时间" : "设置目标到期时间"}
              >
                {space.target_date ? (
                  <span className={`inline-flex items-center gap-1 ${bjDate(space.target_date) < bjToday() ? "text-danger" : ""}`}>
                    <Hourglass size={11} aria-hidden /> {bjDate(space.target_date)}
                    {bjDate(space.target_date) < bjToday() && " 已过期"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-ink-faint">
                    <Plus size={11} aria-hidden /> 设目标
                  </span>
                )}
              </button>
            )}
            {days != null && <span>第 {days} 天</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/spaces" className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-ink-mute transition hover:bg-soft hover:text-accent">
            <ArrowLeft size={12} aria-hidden /> 列表
          </Link>
          {/* 内置运动空间菜单只有归档/删除（均被服务端守卫禁止）——不渲染 ⋯ 入口 */}
          {space.kind === "sport" ? null : (
            <button
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                // 移动端不传锚点（null）：菜单走全宽底部弹层形态，内联 top/left 与 sm: 弹层类四向约束冲突会错位（todo-board 同口径）
                openSpaceMenu(
                  window.innerWidth >= 640
                    ? { top: Math.min(r.bottom + 6, window.innerHeight - 240), left: Math.max(8, r.right - 224) }
                    : null,
                );
              }}
              title="更多操作"
              className="rounded px-2 py-1 leading-none text-ink-dim transition hover:bg-soft hover:text-ink"
            >
              <Ellipsis size={14} />
            </button>
          )}
        </div>
      </div>
      {/* 阶段目标（REQ-019 FR-B1）：取代 todo/行动完成率，作为空间进度口径 */}
      <MilestoneSection id={id} color={space.color} setSpace={setSpace} />
    </div>
  );
}
