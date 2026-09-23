"use client";

import type { Dispatch, SetStateAction } from "react";
import { FilterChip, TagChip } from "@/components/tag-chip";
import type { DatasetSpec } from "@/components/admin-data-panel/types";
import UserDataSection from "./user-data-section";
import type { PromptItem, UserDataEntry } from "./types";

interface Props {
  sel: PromptItem;
  setDirty: Dispatch<SetStateAction<boolean>>;
  tplDraft: string;
  setTplDraft: Dispatch<SetStateAction<string>>;
  tplMissing: string[];
  tplUnknown: string[];
  tplDirty: boolean;
  cfgDirty: boolean;
  onFillMissing: (p: string) => void;
  onResetTpl: () => void;
  injectDraft: Record<string, boolean>;
  setInjectDraft: Dispatch<SetStateAction<Record<string, boolean>>>;
  capsDraft: Record<string, number>;
  setCapsDraft: Dispatch<SetStateAction<Record<string, number>>>;
  previewSample: string;
  setPreviewSample: Dispatch<SetStateAction<string>>;
  previewPeriod: string;
  setPreviewPeriod: Dispatch<SetStateAction<string>>;
  previewing: boolean;
  onPreview: () => void;
  previewText: string | null;
  isReview: boolean;
  periodPlaceholder: string;
  // 🧩 个性化注入（REQ-005 FR-5.6）：独立折叠区，透传给 UserDataSection
  userDataDraft: UserDataEntry[];
  setUserDataDraft: Dispatch<SetStateAction<UserDataEntry[]>>;
  userDataDirty: boolean;
  userDataEstChars: number;
  userDataOverCap: boolean;
  catalogDatasets: DatasetSpec[] | null;
  catalogLoading: boolean;
  onEnsureCatalog: () => void;
}

/** ===== 第二段：输入装配（3-A）：user 模板 + 占位符校验/一键补齐 + 注入开关 + 参数 + 装配预览（零 token） ===== */
export default function InputAssemblySection({
  sel,
  setDirty,
  tplDraft,
  setTplDraft,
  tplMissing,
  tplUnknown,
  tplDirty,
  cfgDirty,
  onFillMissing,
  onResetTpl,
  injectDraft,
  setInjectDraft,
  capsDraft,
  setCapsDraft,
  previewSample,
  setPreviewSample,
  previewPeriod,
  setPreviewPeriod,
  previewing,
  onPreview,
  previewText,
  isReview,
  periodPlaceholder,
  userDataDraft,
  setUserDataDraft,
  userDataDirty,
  userDataEstChars,
  userDataOverCap,
  catalogDatasets,
  catalogLoading,
  onEnsureCatalog,
}: Props) {
  return (
    <section className="glass mb-3 rounded-2xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FilterChip label="② 输入装配（user）" active variant="pill" onClick={() => {}} />
        {tplDirty && <TagChip label="模板已覆盖" tone="emerald" size="sm" />}
        {cfgDirty && <TagChip label="配置已调整" tone="emerald" size="sm" />}
      </div>

      {/* user 模板编辑 */}
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-dim">
        <span className="font-medium text-ink-soft">user 模板</span>
        <span>合法占位符：</span>
        {sel.registry.placeholders.map((p) => {
          const missing = tplMissing.includes(p);
          return (
            <button
              key={p}
              onClick={() => onFillMissing(p)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                missing ? "bg-rose-500/15 text-danger hover:bg-rose-500/25" : "bg-sky-500/10 text-accent hover:bg-sky-500/20"
              }`}
              title={missing ? "缺失中——点击追加到模板末尾" : "已包含"}
            >
              {`{${p}}`}
            </button>
          );
        })}
        {tplDraft !== sel.userTemplateDefault && (
          <button
            onClick={onResetTpl}
            className="rounded px-1.5 py-0.5 text-[10px] text-ink-mute hover:bg-soft hover:text-accent"
          >
            还原默认
          </button>
        )}
      </p>
      <textarea
        value={tplDraft}
        onChange={(e) => {
          setTplDraft(e.target.value.slice(0, 50000));
          setDirty(true);
        }}
        rows={5}
        spellCheck={false}
        className="w-full resize-y rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-sky-500/60"
      />
      {(tplMissing.length > 0 || tplUnknown.length > 0) && (
        <p className="mt-1 text-[11px] text-danger">
          占位符校验：{tplMissing.length ? `缺失 ${tplMissing.map((x) => `{${x}}`).join("、")}（点上方红色占位符一键补齐）` : ""}
          {tplUnknown.length ? ` 未知 ${tplUnknown.map((x) => `{${x}}`).join("、")}` : ""}
        </p>
      )}

      {/* 注入开关 */}
      <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">注入项</p>
      <ul className="space-y-1">
        {sel.registry.injects.map((i) => {
          const on = injectDraft[i.key] ?? i.default;
          const locked = !!i.required;
          return (
            <li key={i.key} className="flex items-start gap-2.5 rounded-lg border border-line-soft bg-bg/30 px-2.5 py-1.5">
              <input
                type="checkbox"
                checked={locked ? true : on}
                disabled={locked}
                onChange={(e) => {
                  setInjectDraft((d) => ({ ...d, [i.key]: e.target.checked }));
                  setDirty(true);
                }}
                title={locked ? "必需注入项，不可关闭" : on ? "点击关闭（线上装配即不含该块）" : "点击开启"}
                className="mt-0.5 h-3.5 w-3.5 accent-sky-500"
              />
              <span className="min-w-0 flex-1">
                <span className={`text-xs font-medium ${locked ? "text-ink-dim" : on ? "text-ink" : "text-ink-faint"}`}>
                  {i.label}
                  {locked && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-warn">必需</span>}
                  {!on && !locked && <span className="ml-1.5 text-[9px] text-ink-faint">已关闭</span>}
                </span>
                <span className="block truncate text-[10px] text-ink-faint" title={i.desc}>{i.desc}</span>
              </span>
              <span className="shrink-0 text-[9px] text-ink-faint" title={i.source}>{i.source}</span>
            </li>
          );
        })}
      </ul>

      {/* 参数 */}
      {sel.registry.caps.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">参数（0 = 不设限；保存即在线上生效，明细类上限在 SQL 查询层生效）</p>
          <div className="flex flex-wrap gap-2">
            {sel.registry.caps.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 rounded-lg border border-line-soft bg-bg/30 px-2.5 py-1.5 text-[11px] text-ink-dim">
                {c.label}
                <input
                  type="number"
                  min={c.min}
                  max={c.max}
                  value={capsDraft[c.key] ?? c.default}
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(c.min, Math.min(c.max, Math.round(Number(e.target.value))));
                    setCapsDraft((d) => ({ ...d, [c.key]: v as number }));
                    setDirty(true);
                  }}
                  className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-right tabular-nums text-ink outline-none focus:border-sky-500"
                />
              </label>
            ))}
          </div>
        </>
      )}

      {/* 装配预览 */}
      <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">装配预览（不调 LLM、零 token；按上方当前配置与你的真实数据装配）</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={previewSample}
          onChange={(e) => setPreviewSample(e.target.value)}
          placeholder="样例话术（可空=取你最近一条真实数据）"
          maxLength={500}
          className="min-w-40 flex-1 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
        />
        {isReview && (
          <input
            value={previewPeriod}
            onChange={(e) => setPreviewPeriod(e.target.value)}
            placeholder={periodPlaceholder}
            maxLength={10}
            className="w-44 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
          />
        )}
        <button
          onClick={onPreview}
          disabled={previewing}
          className="whitespace-nowrap rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20 disabled:opacity-50"
        >
          {previewing ? "装配中…" : "🔍 装配预览"}
        </button>
      </div>
      {previewText !== null && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-3 font-mono text-[10px] leading-relaxed text-ink">
          {previewText}
        </pre>
      )}

      {/* ===== 🧩 个性化注入（REQ-005 FR-5.6）：独立折叠、默认收起；上方注入开关/caps/模板功能不变 ===== */}
      <UserDataSection
        userDataDraft={userDataDraft}
        setUserDataDraft={setUserDataDraft}
        setDirty={setDirty}
        userDataDirty={userDataDirty}
        userDataEstChars={userDataEstChars}
        userDataOverCap={userDataOverCap}
        catalogDatasets={catalogDatasets}
        catalogLoading={catalogLoading}
        onEnsureCatalog={onEnsureCatalog}
      />
    </section>
  );
}
