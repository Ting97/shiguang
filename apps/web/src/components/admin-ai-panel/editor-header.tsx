"use client";

import { TagChip } from "@/components/tag-chip";
import { zhTime } from "./kit";
import type { PromptItem } from "./types";

interface Props {
  sel: PromptItem;
  dirty: boolean;
  saving: boolean;
  draft: string;
  onSave: () => void;
  onRevert: () => void;
  revertArmed?: boolean;
  /** 保存拦截（REQ-005 FR-5.6：个性化注入估算超 8000 字符时禁用；不传 = 不拦截，既有行为不变） */
  saveBlocked?: boolean;
  saveBlockReason?: string;
}

/** 三段式编辑器标题行：覆盖态徽标 + 保存 / 恢复代码默认 */
export default function EditorHeader({ sel, dirty, saving, draft, onSave, onRevert, revertArmed, saveBlocked, saveBlockReason }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold text-ink">{sel.title}</h3>
      <TagChip label={sel.key} tone="slate" size="sm" />
      {sel.overridden ? (
        <TagChip icon="🟢" label="DB 覆盖" tone="emerald" size="sm" title={`更新于 ${zhTime(sel.updatedAt)}`} />
      ) : (
        <TagChip label="代码默认" tone="sky" size="sm" />
      )}
      {!sel.enabled && <TagChip icon="⏸" label="已停用·用默认" tone="amber" size="sm" />}
      <span className="flex-1" />
      {dirty && <TagChip label="未保存" tone="amber" size="sm" />}
      <button
        onClick={onSave}
        disabled={saving || !draft.trim() || saveBlocked}
        title={saveBlocked ? (saveBlockReason ?? "当前配置暂不可保存") : undefined}
        className="btn-primary rounded-xl px-4 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存（立即生效）"}
      </button>
      {sel.overridden && (
        <button
          onClick={onRevert}
          title={revertArmed ? "3 秒内再点确认" : "删除 DB 覆盖，全部回退代码默认（立即生效）"}
          className={`rounded-lg border px-3 py-1.5 text-xs transition ${revertArmed ? "border-rose-500 bg-rose-500/10 font-medium text-danger" : "border-line-soft bg-surface/60 text-ink-soft hover:border-rose-500/50 hover:text-danger"}`}
        >
          {revertArmed ? "确认恢复默认？" : "恢复代码默认"}
        </button>
      )}
    </div>
  );
}
