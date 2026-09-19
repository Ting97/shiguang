"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { CONTACT_GROUPS, GROUP_EMOJI, IMPORTANCE_TIERS, importanceLabel } from "@/lib/social";
import { lunarDayLabel, lunarMonthLabel } from "@/lib/lunar";

export interface ContactDraft {
  id: string;
  name: string;
  alias: string | null;
  group_tag: string;
  birthday: string | null;
  birthday_cal?: string | null;
  lunar_month?: number | null;
  lunar_day?: number | null;
  lunar_leap?: boolean | null;
  anniversary: string | null;
  importance?: number;
  notes: string | null;
}

const LUNAR_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const LUNAR_DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

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
  const [bdayCal, setBdayCal] = useState<"solar" | "lunar">(initial?.birthday_cal === "lunar" ? "lunar" : "solar");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [lunarMonth, setLunarMonth] = useState<number>(initial?.lunar_month ?? 1);
  const [lunarDay, setLunarDay] = useState<number>(initial?.lunar_day ?? 1);
  const [lunarLeap, setLunarLeap] = useState(!!initial?.lunar_leap);
  const [anniversary, setAnniversary] = useState(initial?.anniversary ?? "");
  const [importance, setImportance] = useState<number>(initial?.importance ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 生日字段统一打包（历法 + 阳历日期 / 农历月日） */
  const birthdayPayload = () => ({
    birthdayCal: bdayCal,
    birthday: bdayCal === "solar" ? birthday || null : null,
    lunarMonth: bdayCal === "lunar" ? lunarMonth : undefined,
    lunarDay: bdayCal === "lunar" ? lunarDay : undefined,
    lunarLeap: bdayCal === "lunar" ? lunarLeap : undefined,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="glass safe-bottom max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl sm:max-w-md sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
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
              maxLength={30}
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
              value={anniversary ?? ""}
              onChange={(e) => setAnniversary(e.target.value)}
              title="纪念日（如：结婚纪念日）"
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
            />
            <span className="flex items-center whitespace-nowrap text-[11px] text-slate-500">纪念日</span>
          </div>
          <div>
            <div className="flex gap-2">
              {/* 生日历法切换：阳历=日期选择；农历=月/日选择 + 闰月标记 */}
              <div className="flex shrink-0 items-center rounded-lg border border-slate-600 bg-slate-900 p-0.5 text-xs">
                {([["solar", "阳历"], ["lunar", "农历"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBdayCal(v)}
                    className={`rounded-md px-2.5 py-1 transition ${
                      bdayCal === v
                        ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {bdayCal === "solar" ? (
                <input
                  type="date"
                  value={birthday ?? ""}
                  onChange={(e) => setBirthday(e.target.value)}
                  title="生日（阳历）"
                  className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <select
                    value={lunarMonth}
                    onChange={(e) => setLunarMonth(Number(e.target.value))}
                    title="农历月"
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-1.5 py-1.5 text-sm outline-none focus:border-sky-500"
                  >
                    {LUNAR_MONTHS.map((m) => (
                      <option key={m} value={m}>{lunarMonthLabel(m)}</option>
                    ))}
                  </select>
                  <select
                    value={lunarDay}
                    onChange={(e) => setLunarDay(Number(e.target.value))}
                    title="农历日"
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-1.5 py-1.5 text-sm outline-none focus:border-sky-500"
                  >
                    {LUNAR_DAYS.map((d) => (
                      <option key={d} value={d}>{lunarDayLabel(d)}</option>
                    ))}
                  </select>
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400" title="闰月生日；当年无闰月时按平月过">
                    <input
                      type="checkbox"
                      checked={lunarLeap}
                      onChange={(e) => setLunarLeap(e.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    闰
                  </label>
                </div>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {bdayCal === "lunar" ? "农历生日每年公历日期不同，会自动换算提醒 · 闰月生日无闰月年份按平月过" : "生日（可空）"}
            </p>
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
                      ...birthdayPayload(),
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
                      ...birthdayPayload(),
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
