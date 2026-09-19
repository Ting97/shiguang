"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/nav";
import IconPicker from "@/components/icon-picker";
import type { Activity } from "@/lib/types";

interface Draft {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultMin: number;
  is_preset?: boolean;
}

export default function CategoriesPage() {
  const [list, setList] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [adding, setAdding] = useState({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/activities");
    setList((await r.json()).activities ?? []);
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
    const r = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adding),
    });
    const j = await r.json();
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? "新增失败" }); return; }
    setMsg({ ok: true, text: `✅ 已新增分类「${adding.name.trim()}」` });
    setAdding({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
    await load();
  }

  async function save() {
    if (!editing) return;
    const r = await fetch(`/api/activities/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, icon: editing.icon, color: editing.color, defaultMin: editing.defaultMin }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? "保存失败" }); return; }
    setEditing(null);
    setMsg({ ok: true, text: "💾 已保存" });
    await load();
  }

  async function remove(a: Activity) {
    if (!window.confirm(`删除分类「${a.name}」？\n其历史时间块与待办将归入「其他」。`)) return;
    const r = await fetch(`/api/activities/${a.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? "删除失败" }); return; }
    setMsg({ ok: true, text: `🗑 已删除「${a.name}」` });
    await load();
  }

  return (
    <main className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Nav />
        <h1 className="text-gradient mb-1 text-center text-3xl font-bold sm:text-4xl">分类<span className="ml-2 align-middle text-sm font-normal tracking-normal text-slate-500">活动分类管理</span></h1>
        <p className="mb-5 text-xs text-slate-500">
          预设分类不可删除（可改名称/图标/颜色/默认时长）；自定义分类删除后其记录归入「其他」
        </p>

        {msg && (
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
            {msg.text}
          </div>
        )}

        {/* 新增 */}
        <div className="glass mb-5 flex flex-wrap items-center gap-2 rounded-2xl p-4">
          <input
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="新分类名称（如：带娃 / 冥想 / 副业）"
            className="min-w-36 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          />
          <IconPicker value={adding.icon} onChange={(icon) => setAdding({ ...adding, icon })} />
          <input
            type="color"
            value={adding.color}
            onChange={(e) => setAdding({ ...adding, color: e.target.value })}
            title="颜色"
            className="h-9 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
          />
          <input
            type="number"
            min={5}
            max={720}
            value={adding.defaultMin}
            onChange={(e) => setAdding({ ...adding, defaultMin: Number(e.target.value) })}
            title="默认时长（分钟）：没说时长时按此记录"
            className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none"
          />
          <span className="text-[10px] text-slate-500">分钟</span>
          <button onClick={add} className="btn-primary rounded-lg px-5 py-1.5 text-sm font-medium">
            新增
          </button>
        </div>

        {/* 列表 */}
        <ul className="space-y-1.5">
          {list.map((a) =>
            editing?.id === a.id ? (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/40 bg-slate-800/60 p-3">
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="min-w-24 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
                />
                <IconPicker value={editing.icon} onChange={(icon) => setEditing({ ...editing, icon })} />
                <input
                  type="color"
                  value={editing.color}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
                />
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={editing.defaultMin}
                  onChange={(e) => setEditing({ ...editing, defaultMin: Number(e.target.value) })}
                  className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm tabular-nums outline-none"
                />
                <span className="text-[10px] text-slate-500">分钟</span>
                <button onClick={() => setEditing(null)} className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-700">取消</button>
                <button onClick={save} className="btn-inline-save rounded px-3 py-1 text-xs font-medium">保存</button>
              </li>
            ) : (
              <li key={a.id} className="glass glass-hover group flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-lg">{a.icon}</span>
                <span className="flex-1 text-sm">
                  {a.name}
                  {a.is_preset && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500">预设</span>}
                </span>
                <span className="text-xs tabular-nums text-slate-500">默认 {a.default_min} 分钟</span>
                <span className="row-actions hidden gap-1 group-hover:flex">
                  <button
                    onClick={() => setEditing({ id: a.id, name: a.name, icon: a.icon, color: a.color, defaultMin: a.default_min ?? 30 })}
                    className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300"
                  >
                    ✏️
                  </button>
                  {!a.is_preset && (
                    <button onClick={() => remove(a)} className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300">
                      🗑
                    </button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
    </main>
  );
}
