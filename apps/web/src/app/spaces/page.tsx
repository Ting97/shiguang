"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Dismissable } from "@/components/dismissable";
import InlineRename from "@/components/inline-rename";
import { TagChip } from "@/components/tag-chip";
import type { Space } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";

/**
 * 目标空间列表（REQ-001 R3）：宏大目标（≥1 年）容器。
 * active 空间卡片（icon 圆底/进度条/持续天数）+ 新建/编辑弹层 + 底部折叠归档区。
 */

const ICONS = ["🎯", "📚", "💪", "💰", "🚀", "🧘", "🎓", "🏃", "✍️", "🎸", "🏠", "❤️"];
const COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#64748b"];

interface Draft {
  name: string;
  description: string;
  icon: string;
  color: string;
  startedAt: string;
  targetDate: string;
}

const EMPTY: Draft = { name: "", description: "", icon: "🎯", color: "#38bdf8", startedAt: "", targetDate: "" };

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null); // null=关闭；"new" 用 EMPTY
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // 加载失败态：给出重试入口，避免网络异常时永远停在"加载中"
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 卡片 ⋯ 菜单（编辑/归档/删除收纳；桌面锚定浮层 / 移动端底部弹层）
  const [cardMenu, setCardMenu] = useState<Space | null>(null);
  const [cardMenuPos, setCardMenuPos] = useState<{ top: number; left: number } | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      // 原 401 分支（location.href = "/login"）已由 shared/api 统一处理；
      // 原 !ok → 置空列表的语义由 ApiClientError 分支保留，网络异常仍走加载失败
      const j = await api<any>("/api/spaces", "GET");
      setSpaces((j.spaces as Space[]) ?? []);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setSpaces([]);
      } else {
        setLoadErr(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    // 本地时区的今天；toISOString() 会取 UTC 日期，北京 0-8 点会默认成昨天
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setEditing({ ...EMPTY, startedAt: localToday });
    setEditingId(null);
  }
  function openEdit(s: Space) {
    setEditing({
      name: s.name,
      description: s.description ?? "",
      icon: s.icon,
      color: s.color,
      startedAt: s.started_at ?? "",
      targetDate: s.target_date ?? "",
    });
    setEditingId(s.id);
  }

  async function save() {
    if (!editing) return;
    const body = {
      name: editing.name,
      description: editing.description || null,
      icon: editing.icon,
      color: editing.color,
      startedAt: editing.startedAt || null,
      targetDate: editing.targetDate || null,
    };
    try {
      await api<any>(editingId ? `/api/spaces/${editingId}` : "/api/spaces", editingId ? "PATCH" : "POST", body);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setMsg({ ok: false, text: e.message === "操作失败" ? "保存失败" : e.message });
        return;
      }
      throw e;
    }
    setEditing(null);
    setMsg({ ok: true, text: editingId ? "空间已更新" : `空间「${editing.name}」已创建 🎯` });
    load();
  }

  async function setStatus(s: Space, status: "active" | "archived") {
    try {
      await api<any>(`/api/spaces/${s.id}`, "PATCH", { status });
    } catch (e) {
      // 原 fetch 版未检查响应：失败也提示并刷新
      if (!(e instanceof ApiClientError)) throw e;
    }
    setMsg({ ok: true, text: status === "archived" ? `「${s.name}」已归档` : `「${s.name}」已恢复` });
    load();
  }

  async function remove(s: Space) {
    const refN = s.reflection_count ?? 0;
    if (!window.confirm(`删除空间「${s.name}」？\n含 ${refN} 篇感悟（将一并删除）；${s.todo_total ?? 0} 条关联 todo、${s.entry_count ?? 0} 条动态仅解除归属。`)) return;
    try {
      await api<any>(`/api/spaces/${s.id}`, "DELETE");
    } catch (e) {
      // 原 fetch 版未检查响应：失败也提示并刷新
      if (!(e instanceof ApiClientError)) throw e;
    }
    setMsg({ ok: true, text: `「${s.name}」已删除` });
    load();
  }

  const active = (spaces ?? []).filter((s) => s.status === "active");
  const archived = (spaces ?? []).filter((s) => s.status === "archived");

  const daysOf = (s: Space) => (s.started_at ? Math.max(1, Math.ceil((Date.now() - new Date(s.started_at).getTime()) / 86_400_000)) : null);
  /** pg date 字段按北京日期还原（node-pg 序列化为 UTC ISO，直接 slice 会差一天） */
  const bjDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const progressOf = (s: Space) => (s.todo_total ? Math.round((s.todo_done ?? 0) / s.todo_total * 100) : null);

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
        {msg && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"}`}>
            {msg.text}
          </div>
        )}

        {/* 模块抬头：与动态/财务统一的居中 hero 样式 */}
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">目标</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">
            创建一个空间，专属于这个目标的 TODO·行动与感悟 —— 相关动态自动归属，见证每天的靠近
          </p>
          <button onClick={openNew} className="btn-primary mt-3 rounded-xl px-4 py-2 text-sm font-medium">
            ＋ 新建空间
          </button>
        </header>

        {spaces === null ? (
          loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button onClick={() => void load()} className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs">
                重试
              </button>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>
          )
        ) : active.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center empty-state">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 text-sm font-medium">还没有目标空间</p>
            <p className="mt-1 text-xs text-ink-dim">为一个大目标（考研上岸 / 副业过万 / 完成全马…）建一个空间，把它的 TODO·行动、感悟和动态都聚在专属容器里</p>
            <button onClick={openNew} className="btn-primary mt-4 rounded-xl px-5 py-2 text-sm font-medium">
              创建第一个空间
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((s) => {
              const days = daysOf(s);
              const progress = progressOf(s);
              return (
                <Link
                  key={s.id}
                  href={`/spaces/${s.id}`}
                  className="glass glass-hover group block rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                      style={{ backgroundColor: `${s.color}26` }}
                    >
                      {s.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="block min-w-0 flex-1">
              <InlineRename
                value={s.name}
                onSave={async (name) => {
                  try {
                    await api<any>(`/api/spaces/${s.id}`, "PATCH", { name });
                  } catch (e) {
                    if (e instanceof ApiClientError) {
                      setMsg({ ok: false, text: e.message === "操作失败" ? "重命名失败" : e.message });
                      return false;
                    }
                    throw e;
                  }
                  setMsg({ ok: true, text: "已重命名" });
                  await load();
                  return true;
                }}
                className="w-full text-sm font-semibold text-ink"
              />
            </span>
                      <p className="mt-0.5 text-[11px] text-ink-dim">
                        {s.todo_total ?? 0} todo · {s.entry_count ?? 0} 动态{days ? ` · 第 ${days} 天` : ""}
                        {s.target_date && ` · ⏳ ${bjDay(s.target_date).slice(5)}`}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setCardMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 240), left: Math.max(8, r.right - 224) });
                        setCardMenu(s);
                      }}
                      title="更多操作"
                      className="row-actions-hidden hidden shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover:block"
                    >
                      ⋯
                    </button>
                  </div>
                  {s.description && <p className="mt-2 line-clamp-2 text-xs text-ink-mute">{s.description}</p>}
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[10px] tabular-nums text-ink-faint">
                      <span>todo 进度</span>
                      <span>{progress == null ? "暂无 todo" : `${progress}%`}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${progress ?? 0}%`, backgroundColor: s.color }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* 归档区 */}
        {archived.length > 0 && (
          <details className="mt-6" open={showArchived}>
            <summary className="cursor-pointer text-xs text-ink-dim" onClick={(e) => { e.preventDefault(); setShowArchived((v) => !v); }}>
              归档空间（{archived.length}）
            </summary>
            <ul className="mt-2 space-y-1.5">
              {archived.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line-soft bg-bg/40 px-3 py-2 text-xs">
                  <span>{s.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-mute">{s.name}</span>
                  <button onClick={() => setStatus(s, "active")} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-soft hover:text-accent">
                    恢复
                  </button>
                  <button onClick={() => remove(s)} className="rounded-lg px-2 py-1 text-ink-mute hover:bg-soft hover:text-danger">
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* 新建/编辑弹层（N3：点空白/Esc 取消，有改动轻提示） */}
        {editing && (
          <Dismissable
            onClose={() => {
              if (editing.name.trim() !== (spaces?.find((s) => s.id === editingId)?.name ?? "")) {
                setMsg({ ok: true, text: "已取消，未保存" });
              }
              setEditing(null);
            }}
            className="fixed inset-x-4 top-1/2 z-[61] -translate-y-1/2 rounded-2xl border border-line-soft bg-surface p-5 shadow-2xl sm:mx-auto sm:max-w-md"
          >
            <h2 className="mb-3 text-sm font-semibold text-ink">{editingId ? "编辑空间" : "新建目标空间"}</h2>
              <input
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value.slice(0, 40) })}
                placeholder="目标名称（如：考研上岸）"
                className="input-glow w-full rounded-xl border border-line-soft bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-ink-faint"
              />
              <textarea
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value.slice(0, 300) })}
                rows={2}
                placeholder="描述（可空：为什么重要、衡量标准…）"
                className="input-glow mt-2 w-full resize-none rounded-xl border border-line-soft bg-surface/60 px-3 py-2 text-xs outline-none placeholder:text-ink-faint"
              />
              <p className="mt-2.5 mb-1 text-[11px] text-ink-faint">图标</p>
              <div className="flex flex-wrap gap-1.5">
                {ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setEditing({ ...editing, icon: ic })}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition ${
                      editing.icon === ic ? "bg-sky-500/20 ring-2 ring-sky-500" : "bg-bg/40 hover:bg-elevated"
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 mb-1 text-[11px] text-ink-faint">颜色</p>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditing({ ...editing, color: c })}
                    className={`h-7 w-7 rounded-full transition ${editing.color === c ? "ring-2 ring-offset-2 ring-offset-surface" : ""}`}
                    style={{ backgroundColor: c, boxShadow: editing.color === c ? `0 0 0 2px ${c}` : undefined }}
                    aria-label={c}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <label className="flex flex-1 flex-col text-[11px] text-ink-faint">
                  开始日期
                  <input
                    type="date"
                    value={editing.startedAt}
                    onChange={(e) => setEditing({ ...editing, startedAt: e.target.value })}
                    className="mt-1 rounded-lg border border-line-soft bg-surface/60 px-2 py-1.5 text-xs text-ink outline-none"
                  />
                </label>
                <label className="flex flex-1 flex-col text-[11px] text-ink-faint">
                  目标日期
                  <input
                    type="date"
                    value={editing.targetDate}
                    onChange={(e) => setEditing({ ...editing, targetDate: e.target.value })}
                    className="mt-1 rounded-lg border border-line-soft bg-surface/60 px-2 py-1.5 text-xs text-ink outline-none"
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded-xl px-4 py-2 text-xs text-ink-mute hover:bg-soft">
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={!editing.name.trim()}
                  className="btn-primary rounded-xl px-5 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {editingId ? "保存" : "创建"}
                </button>
              </div>
          </Dismissable>
        )}

        {/* 卡片 ⋯ 菜单：编辑/归档/删除收纳（桌面锚定浮层 / 移动端底部弹层） */}
        {cardMenu &&
          createPortal(
            <Dismissable
              onClose={() => setCardMenu(null)}
              className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
              style={cardMenuPos ? { top: cardMenuPos.top, left: cardMenuPos.left } : undefined}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
              <p className="mb-1.5 truncate px-1.5 text-[11px] font-medium text-ink-dim">{cardMenu.name}</p>
              <div className="space-y-0.5">
                <button
                  onClick={() => { const s = cardMenu; setCardMenu(null); openEdit(s); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-wash"
                >
                  <span className="w-5 shrink-0 text-center text-sm leading-none">✏️</span>
                  <span className="min-w-0 flex-1">编辑空间</span>
                </button>
                <button
                  onClick={() => { const s = cardMenu; setCardMenu(null); void setStatus(s, "archived"); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-warn transition hover:bg-wash"
                >
                  <span className="w-5 shrink-0 text-center text-sm leading-none">📦</span>
                  <span className="min-w-0 flex-1">归档空间</span>
                </button>
                <button
                  onClick={() => { const s = cardMenu; setCardMenu(null); void remove(s); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-danger transition hover:bg-rose-500/10"
                >
                  <span className="w-5 shrink-0 text-center text-sm leading-none">🗑</span>
                  <span className="min-w-0 flex-1">删除空间</span>
                </button>
              </div>
            </Dismissable>,
            document.body,
          )}

        <footer className="mt-10 text-center">
          <TagChip icon="🎯" label="拾光 · 目标空间" tone="violet" size="sm" />
        </footer>
      </div>
    </main>
  );
}
