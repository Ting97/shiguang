"use client";

import type { Dispatch, SetStateAction } from "react";
import { FilterChip, TagChip } from "@/components/tag-chip";
import { zhTime } from "./kit";
import type { Version } from "./types";

interface Props {
  versions: Version[] | null;
  showVersions: boolean;
  setShowVersions: Dispatch<SetStateAction<boolean>>;
  enabled: boolean;
  setEnabled: Dispatch<SetStateAction<boolean>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  onLoadSystem: (v: Version) => void;
  onRollback: (v: Version) => Promise<void>;
  /** 处于待确认态的回滚版本 id（按钮呈「确认回滚?」） */
  armedRollbackId?: number | null;
}

/** ===== 第三段：版本历史（三件套快照，载入单件 / 整体回滚；启用开关关闭 = 整 key 回退代码默认） ===== */
export default function VersionsSection({
  versions,
  showVersions,
  setShowVersions,
  enabled,
  setEnabled,
  setDirty,
  onLoadSystem,
  onRollback,
  armedRollbackId,
}: Props) {
  return (
    <section className="glass mb-3 rounded-2xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FilterChip label="③ 版本历史" active variant="pill" onClick={() => {}} />
        <span className="flex-1" />
        <button
          onClick={() => setShowVersions((v) => !v)}
          className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
        >
          {showVersions ? "收起" : "展开"} {versions?.length ? `(${versions.length})` : ""}
        </button>
      </div>
      {showVersions && (
        <>
          {!versions ? (
            <p className="text-[11px] text-ink-faint">加载中…</p>
          ) : versions.length === 0 ? (
            <p className="text-[11px] text-ink-faint">还没有保存记录 —— 每次保存会自动留三件套快照</p>
          ) : (
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                  <span className="tabular-nums">{zhTime(v.created_at)}</span>
                  <span className="tabular-nums">{v.size} 字</span>
                  {v.payload ? <TagChip label="三件套" tone="sky" size="sm" title="含 system + user 模板 + 注入配置" /> : <TagChip label="仅 system" tone="slate" size="sm" />}
                  {v.restored_from && <TagChip label="回滚" tone="amber" size="sm" title={`来自版本 #${v.restored_from}`} />}
                  <span className="truncate text-ink-faint">{v.created_by_name ?? "—"}</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => onLoadSystem(v)}
                    className="rounded px-2 py-0.5 text-ink-soft hover:bg-soft hover:text-accent"
                  >
                    载入 system
                  </button>
                  <button
                    onClick={() => void onRollback(v)}
                    className={`rounded px-2 py-0.5 ${armedRollbackId === v.id ? "bg-rose-500/15 font-medium text-danger" : "text-ink-soft hover:bg-soft hover:text-warn"}`}
                    title={armedRollbackId === v.id ? "3 秒内再点确认（三件套整体恢复并立即生效）" : "整体恢复该版本的三件套并立即生效"}
                  >
                    {armedRollbackId === v.id ? "确认回滚?" : "回滚"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-2 text-[10px] text-ink-faint">保存即生效（≤60s 缓存、主动失效）；启用开关关闭 = 整 key 回退代码默认</p>
      <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-ink-mute" title="关闭后此 key 使用代码默认值">
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} className="h-3.5 w-3.5 accent-sky-500" />
        启用此覆盖
      </label>
    </section>
  );
}
