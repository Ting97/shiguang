"use client";

import type { Dispatch, SetStateAction } from "react";
import { FilterChip, TagChip } from "@/components/tag-chip";
import type { PromptItem } from "./types";

interface Props {
  sel: PromptItem;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  showCompare: boolean;
  setShowCompare: Dispatch<SetStateAction<boolean>>;
  optHint: string;
  setOptHint: Dispatch<SetStateAction<string>>;
  optimizing: boolean;
  onOptimize: () => void;
  suggestion: string | null;
  onAdopt: () => void;
  onDismissSuggestion: () => void;
}

/** ===== 第一段：System prompt（编辑 / 对比默认值 / ✨AI 优化） ===== */
export default function SystemPromptSection({
  sel,
  draft,
  setDraft,
  setDirty,
  showCompare,
  setShowCompare,
  optHint,
  setOptHint,
  optimizing,
  onOptimize,
  suggestion,
  onAdopt,
  onDismissSuggestion,
}: Props) {
  return (
    <section className="glass mb-3 rounded-2xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FilterChip label="① System prompt" active variant="pill" onClick={() => {}} />
        <span className="flex-1" />
        <button
          onClick={() => setShowCompare((v) => !v)}
          className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
        >
          {showCompare ? "收起对比" : "对比默认值"}
        </button>
      </div>

      {/* AI 优化入口 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          value={optHint}
          onChange={(e) => setOptHint(e.target.value)}
          placeholder="优化意图（可空，如：更严格约束日期）"
          maxLength={200}
          className="min-w-40 flex-1 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-violet-500"
        />
        <button
          onClick={onOptimize}
          disabled={optimizing}
          className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-ai transition hover:bg-purple-500/20 disabled:opacity-50"
        >
          {optimizing ? "优化中…" : "✨ AI 优化"}
        </button>
      </div>

      {/* AI 建议对比（并排） */}
      {suggestion !== null && (
        <div className="mb-3 rounded-xl border border-purple-500/30 bg-purple-500/[0.06] p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-ai">
            <TagChip icon="✨" label="AI 优化建议" tone="violet" size="sm" />
            <span className="font-normal text-ink-dim">采纳后仅填入编辑器，检查无误再手动保存</span>
            <span className="flex-1" />
            <button
              onClick={onAdopt}
              className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
            >
              采纳
            </button>
            <button onClick={onDismissSuggestion} className="rounded-lg px-2.5 py-1 text-[11px] text-ink-mute hover:bg-soft">
              放弃
            </button>
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] text-ink-faint">当前（编辑器）</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 text-[10px] leading-relaxed text-ink-soft">{draft}</pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] text-ink-faint">AI 建议</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 text-[10px] leading-relaxed text-ink">{suggestion}</pre>
            </div>
          </div>
        </div>
      )}

      {/* 编辑器 + 对比默认值 */}
      <div className={showCompare ? "grid gap-2 md:grid-cols-2" : ""}>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, 50000));
            setDirty(true);
          }}
          rows={12}
          spellCheck={false}
          className="input-glow w-full resize-y rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none"
        />
        {showCompare && (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border border-line-soft bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-ink-mute">
            {sel.defaultContent}
          </pre>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-faint">{draft.length}/50000 · 关闭下方「启用此覆盖」或点「恢复代码默认」= 整 key 回退代码默认</p>
    </section>
  );
}
