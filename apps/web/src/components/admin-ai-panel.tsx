"use client";

import { useCallback, useEffect, useState } from "react";
import { TagChip, FilterChip } from "./tag-chip";

/**
 * /admin · AI 管理模块（REQ-001 R4）：
 * - 左列 prompt 清单（分类分组、覆盖态徽标、启用开关）；移动端横滑、PC 左栏
 * - 右侧编辑器：保存即生效（清缓存）；对比默认值；版本历史回滚；恢复代码默认
 * - ✨AI 优化：出建议稿 → 并排对比 → 采纳仅填入编辑器（不自动保存）
 */

interface PromptItem {
  key: string;
  title: string;
  category: "识别" | "复盘" | "目标" | "系统";
  enabled: boolean;
  overridden: boolean;
  dbContent: string | null;
  remark: string | null;
  updatedAt: string | null;
  defaultContent: string;
}

interface Version {
  id: number;
  content: string;
  restored_from: number | null;
  created_at: string;
  created_by_name: string | null;
  size: number;
}

const zhTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AdminAiPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [sel, setSel] = useState<PromptItem | null>(null);
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [optHint, setOptHint] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/prompts");
    const j = await r.json();
    if (!r.ok) {
      notify(j.error ?? "加载失败", false);
      return;
    }
    setItems(j.items as PromptItem[]);
    return j.items as PromptItem[];
  }, [notify]);

  const loadVersions = useCallback(async (key: string) => {
    const r = await fetch(`/api/admin/prompts/${key}`);
    setVersions(r.ok ? (await r.json()).versions : null);
  }, []);

  useEffect(() => {
    load().then((list) => {
      if (list?.length) pick(list[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(item: PromptItem) {
    setSel(item);
    setDraft(item.dbContent ?? item.defaultContent);
    setEnabled(item.enabled);
    setDirty(false);
    setSuggestion(null);
    setShowCompare(false);
    setShowVersions(false);
    void loadVersions(item.key);
  }

  async function save() {
    if (!sel || !draft.trim() || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/prompts/${sel.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, enabled }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失败");
      notify(`「${sel.title}」已保存并即时生效`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setSaving(false);
    }
  }

  async function revertDefault() {
    if (!sel || !window.confirm(`恢复「${sel.title}」为代码默认值？（删除 DB 覆盖，立即生效）`)) return;
    const r = await fetch(`/api/admin/prompts/${sel.key}`, { method: "DELETE" });
    if (r.ok) {
      notify(`「${sel.title}」已恢复代码默认`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } else notify("操作失败", false);
  }

  async function rollback(v: Version) {
    if (!sel) return;
    const r = await fetch(`/api/admin/prompts/${sel.key}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: v.id }),
    });
    const j = await r.json();
    if (!r.ok) {
      notify(j.error ?? "回滚失败", false);
      return;
    }
    notify(`已回滚到 ${zhTime(v.created_at)} 的版本`);
    const list = await load();
    const fresh = list?.find((x) => x.key === sel.key);
    if (fresh) pick(fresh);
  }

  async function optimize() {
    if (!sel || optimizing) return;
    setOptimizing(true);
    setSuggestion(null);
    try {
      const r = await fetch(`/api/admin/prompts/${sel.key}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hint: optHint }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "优化失败");
      setSuggestion(j.suggestion);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setOptimizing(false);
    }
  }

  if (!items) return <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>;

  const categories: PromptItem["category"][] = ["识别", "复盘", "目标", "系统"];

  return (
    <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-5">
      {/* prompt 清单：移动横滑 / PC 左栏 */}
      <div className="scrollbar-none -mx-5 mb-3 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:mb-0 lg:block lg:space-y-2.5 lg:overflow-visible lg:px-0">
        {categories.map((cat) => {
          const list = items.filter((x) => x.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="flex gap-1.5 lg:block lg:space-y-1">
              <p className="hidden px-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint lg:block">{cat}</p>
              {list.map((it) => (
                <button
                  key={it.key}
                  onClick={() => pick(it)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs transition-all duration-200 lg:w-full ${
                    sel?.key === it.key
                      ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                      : "text-ink-mute hover:bg-wash hover:text-ink"
                  }`}
                >
                  {it.title}
                  {it.overridden && (
                    <span
                      title={it.enabled ? "DB 覆盖生效中" : "覆盖已停用（用代码默认）"}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.enabled ? "bg-emerald-400" : "bg-amber-400"}`}
                    />
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 编辑器 */}
      {sel && (
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{sel.title}</h3>
            <TagChip label={sel.key} tone="slate" size="sm" />
            {sel.overridden ? (
              <TagChip icon="🟢" label="DB 覆盖" tone="emerald" size="sm" title={`更新于 ${zhTime(sel.updatedAt)}`} />
            ) : (
              <TagChip label="代码默认" tone="sky" size="sm" />
            )}
            {!sel.enabled && <TagChip icon="⏸" label="已停用·用默认" tone="amber" size="sm" />}
            <span className="flex-1" />
            <button
              onClick={() => setShowCompare((v) => !v)}
              className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
            >
              {showCompare ? "收起对比" : "对比默认值"}
            </button>
            <button
              onClick={() => setShowVersions((v) => !v)}
              className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
            >
              版本历史 {versions?.length ? `(${versions.length})` : ""}
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
              onClick={optimize}
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
                  onClick={() => {
                    setDraft(suggestion);
                    setDirty(true);
                    setSuggestion(null);
                    notify("已采纳到编辑器（未保存）");
                  }}
                  className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
                >
                  采纳
                </button>
                <button onClick={() => setSuggestion(null)} className="rounded-lg px-2.5 py-1 text-[11px] text-ink-mute hover:bg-soft">
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
              rows={16}
              spellCheck={false}
              className="input-glow w-full resize-y rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none"
            />
            {showCompare && (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-line-soft bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-ink-mute">
                {sel.defaultContent}
              </pre>
            )}
          </div>

          {/* 操作行 */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-mute" title="关闭后此 key 使用代码默认值">
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} className="h-3.5 w-3.5 accent-sky-500" />
              启用此覆盖
            </label>
            <span className="text-[10px] tabular-nums text-ink-faint">{draft.length}/50000</span>
            {dirty && <TagChip label="未保存" tone="amber" size="sm" />}
            <span className="flex-1" />
            {sel.overridden && (
              <button onClick={revertDefault} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-ink-soft transition hover:border-rose-500/50 hover:text-danger">
                恢复代码默认
              </button>
            )}
            <button
              onClick={save}
              disabled={saving || !draft.trim()}
              className="btn-primary rounded-xl px-4 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存（立即生效）"}
            </button>
          </div>

          {/* 版本历史 */}
          {showVersions && (
            <div className="mt-3 rounded-xl border border-line-soft bg-bg/40 p-3">
              <p className="mb-2 text-xs font-medium text-ink-soft">版本历史（最近 30 条）</p>
              {!versions ? (
                <p className="text-[11px] text-ink-faint">加载中…</p>
              ) : versions.length === 0 ? (
                <p className="text-[11px] text-ink-faint">还没有保存记录 —— 每次保存会自动留快照</p>
              ) : (
                <ul className="space-y-1">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 text-[11px] text-ink-mute">
                      <span className="tabular-nums">{zhTime(v.created_at)}</span>
                      <span className="tabular-nums">{v.size} 字</span>
                      {v.restored_from && <TagChip label="回滚" tone="amber" size="sm" title={`来自版本 #${v.restored_from}`} />}
                      <span className="truncate text-ink-faint">{v.created_by_name ?? "—"}</span>
                      <span className="flex-1" />
                      <button
                        onClick={() => {
                          setDraft(v.content);
                          setDirty(true);
                          notify("已载入该版本内容到编辑器（未保存）");
                        }}
                        className="rounded px-2 py-0.5 text-ink-soft hover:bg-soft hover:text-accent"
                      >
                        载入
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
