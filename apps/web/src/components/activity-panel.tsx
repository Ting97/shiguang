"use client";

import { useCallback, useEffect, useState } from "react";
import IconPicker from "@/components/icon-picker";
import type { Activity } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";

/** 日程页 · 分类子页：活动分类管理（原 /categories 页整体平移，逻辑不变） */

interface Draft {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultMin: number;
  is_preset?: boolean;
}

export default function ActivityPanel() {
  const [list, setList] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [adding, setAdding] = useState({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 新增/保存进行中锁，防连点重复提交
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await api<any>("/api/activities");
      setList(j.activities ?? []);
    } catch (e) {
      // 失败置空列表 + 提示（裸 rejection 会触发 ChunkErrorReloader 整页刷新循环）
      setList([]);
      setMsg({ ok: false, text: e instanceof Error ? e.message : "加载失败" });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  async function add() {
    if (!adding.name.trim()) { setMsg({ ok: false, text: "名称必填" }); return; }
    if (busy) return;
    setBusy(true);
    try {
      await api<any>("/api/activities", "POST", adding);
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      if (e instanceof ApiClientError) { setMsg({ ok: false, text: e.message === "操作失败" ? "新增失败" : e.message }); return; }
      setMsg({ ok: false, text: "网络异常，请稍后重试" });
      return;
    } finally {
      setBusy(false);
    }
    setMsg({ ok: true, text: `✅ 已新增分类「${adding.name.trim()}」` });
    setAdding({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
    await load();
  }

  async function save() {
    if (!editing) return;
    if (busy) return;
    setBusy(true);
    try {
      await api<any>(`/api/activities/${editing.id}`, "PATCH", { name: editing.name, icon: editing.icon, color: editing.color, defaultMin: editing.defaultMin });
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      if (e instanceof ApiClientError) { setMsg({ ok: false, text: e.message === "操作失败" ? "保存失败" : e.message }); return; }
      setMsg({ ok: false, text: "网络异常，请稍后重试" });
      return;
    } finally {
      setBusy(false);
    }
    setEditing(null);
    setMsg({ ok: true, text: "💾 已保存" });
    await load();
  }

  async function remove(a: Activity) {
    if (!window.confirm(`删除分类「${a.name}」？\n其历史时间块与 todo 将归入「其他」。`)) return;
    try {
      await api<any>(`/api/activities/${a.id}`, "DELETE");
    } catch (e) {
      // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
      if (e instanceof ApiClientError) { setMsg({ ok: false, text: e.message === "操作失败" ? "删除失败" : e.message }); return; }
      setMsg({ ok: false, text: "网络异常，请稍后重试" });
      return;
    }
    setMsg({ ok: true, text: `🗑 已删除「${a.name}」` });
    await load();
  }

  return (
    <div>
      <p className="mb-4 text-xs text-ink-dim">
        预设分类不可删除（可改名称/图标/颜色/默认时长）；自定义分类删除后其记录归入「其他」
      </p>

      {msg && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-success" : "border-rose-500/30 bg-rose-500/10 text-danger"}`}>
          {msg.text}
        </div>
      )}

      {/* 新增（移动端纵向堆叠、控件全宽，触控目标 ≥40px） */}
      <div className="glass mb-5 flex flex-wrap items-center gap-2 rounded-2xl p-4">
        <input
          value={adding.name}
          onChange={(e) => setAdding({ ...adding, name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
          placeholder="新分类名称（如：带娃 / 冥想 / 副业）"
          maxLength={30}
          className="min-w-36 flex-1 rounded border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-sky-500"
        />
        <IconPicker value={adding.icon} onChange={(icon) => setAdding({ ...adding, icon })} />
        <input
          type="color"
          value={adding.color}
          onChange={(e) => setAdding({ ...adding, color: e.target.value })}
          title="颜色"
          className="h-10 w-12 cursor-pointer rounded border border-line-strong bg-surface"
        />
        <input
          type="number"
          min={5}
          max={720}
          value={adding.defaultMin}
          onChange={(e) => setAdding({ ...adding, defaultMin: Number(e.target.value) })}
          title="默认时长（分钟）：没说时长时按此记录"
          className="w-20 rounded border border-line-strong bg-surface px-2 py-2 text-sm tabular-nums outline-none"
        />
        <span className="text-[10px] text-ink-dim">分钟</span>
        <button onClick={add} className="btn-primary rounded-lg px-5 py-2 text-sm font-medium">
          新增
        </button>
      </div>

      {/* 列表 */}
      <ul className="space-y-1.5">
        {list.map((a) =>
          editing?.id === a.id ? (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/40 bg-elevated/60 p-3">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                maxLength={30}
                className="min-w-24 flex-1 rounded border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              />
              <IconPicker value={editing.icon} onChange={(icon) => setEditing({ ...editing, icon })} />
              <input
                type="color"
                value={editing.color}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                className="h-9 w-11 cursor-pointer rounded border border-line-strong bg-surface"
              />
              <input
                type="number"
                min={5}
                max={720}
                value={editing.defaultMin}
                onChange={(e) => setEditing({ ...editing, defaultMin: Number(e.target.value) })}
                className="w-20 rounded border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none"
              />
              <span className="text-[10px] text-ink-dim">分钟</span>
              <button onClick={() => setEditing(null)} className="rounded px-3 py-1.5 text-xs text-ink-mute hover:bg-soft">取消</button>
              <button onClick={save} className="btn-inline-save rounded px-3 py-1.5 text-xs font-medium">保存</button>
            </li>
          ) : (
            <li key={a.id} className="glass glass-hover group flex items-center gap-3 rounded-xl px-3 py-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-lg">{a.icon}</span>
              <span className="flex-1 text-sm">
                {a.name}
                {a.is_preset && <span className="ml-2 rounded bg-elevated px-1.5 py-0.5 text-[9px] text-ink-dim">预设</span>}
              </span>
              <span className="text-xs tabular-nums text-ink-dim">默认 {a.default_min} 分钟</span>
              <span className="row-actions hidden gap-1 group-hover:flex">
                <button
                  onClick={() => setEditing({ id: a.id, name: a.name, icon: a.icon, color: a.color, defaultMin: a.default_min ?? 30 })}
                  className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-accent"
                >
                  ✏️
                </button>
                {!a.is_preset && (
                  <button onClick={() => remove(a)} className="rounded px-1.5 py-0.5 text-xs text-ink-mute hover:bg-soft hover:text-danger">
                    🗑
                  </button>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
