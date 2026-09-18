"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { CONTACT_GROUPS, GROUP_EMOJI, IMPORTANCE_TIERS, importanceLabel } from "@/lib/social";

export interface ContactDraft {
  id: string;
  name: string;
  alias: string | null;
  group_tag: string;
  birthday: string | null;
  anniversary: string | null;
  importance?: number;
  notes: string | null;
}

/** 建档/编辑联系人弹层（列表页与 TA 档案页共用） */
export default function ContactFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: ContactDraft | null;
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [group, setGroup] = useState(initial?.group_tag ?? "朋友");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [anniversary, setAnniversary] = useState(initial?.anniversary ?? "");
  const [importance, setImportance] = useState<number>(initial?.importance ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-md rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">{initial ? "编辑联系人" : "新建联系人"}</h3>
          <button onClick={onClose} className="rounded px-2 text-slate-500 hover:text-slate-200">✕</button>
        </div>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="姓名（必填）"
              className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
            />
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="备注名（如：老王）"
              className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
            >
              {CONTACT_GROUPS.map((g) => (
                <option key={g} value={g}>{GROUP_EMOJI[g]} {g}</option>
              ))}
            </select>
            <input
              type="date"
              value={birthday ?? ""}
              onChange={(e) => setBirthday(e.target.value)}
              title="生日"
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={anniversary ?? ""}
              onChange={(e) => setAnniversary(e.target.value)}
              title="纪念日（如：结婚纪念日）"
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
            />
            <span className="flex items-center text-[11px] text-slate-500">纪念日（可空）</span>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
              重要程度
              <span className="text-slate-400">决定图谱中与你的距离 · 当前：{importanceLabel(importance)}</span>
            </div>
            <div className="flex gap-1">
              {[...IMPORTANCE_TIERS].reverse().map((t) => (
                <button
                  key={t.level}
                  type="button"
                  onClick={() => setImportance(t.level)}
                  className={`flex-1 rounded-lg px-1 py-1.5 text-xs transition ${
                    importance === t.level
                      ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white"
                      : "border border-slate-600 bg-slate-900 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="备注：喜好/忌讳/重要的事…"
            className="w-full resize-none rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          />
          {err && <p className="text-xs text-rose-300">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-xs text-slate-400 hover:bg-slate-700">
              取消
            </button>
            <button
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  if (initial) {
                    await api(`/api/contacts/${initial.id}`, "PATCH", {
                      name: name.trim(),
                      alias,
                      group,
                      birthday: birthday || null,
                      anniversary: anniversary || null,
                      importance,
                      notes,
                    });
                    await onSaved("💾 档案已更新");
                  } else {
                    await api("/api/contacts", "POST", {
                      name: name.trim(),
                      alias,
                      group,
                      birthday: birthday || null,
                      anniversary: anniversary || null,
                      importance,
                      notes,
                    });
                    await onSaved(`✅ 已建档：${name.trim()}`);
                  }
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {busy ? "保存中…" : initial ? "保存" : "建档"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
