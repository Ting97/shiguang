"use client";

import { useCallback, useEffect, useState } from "react";

/** 列表条目：预览 300 字 + 字数（GET 列表不回全文，FR-N2.4） */
export interface ReflectionItem {
  id: string;
  preview: string;
  chars: number;
  created_at: string;
  updated_at: string;
  edited: boolean;
}

/**
 * N2 空间感悟列表（REQ-002）：时间线倒序、点条目展开全文（就地拉取）、✏️ 编辑 / 🗑 删除、加载更多。
 */
export default function SpaceReflections({
  spaceId,
  notify,
  onEdit,
  onChanged,
}: {
  spaceId: string;
  notify: (m: { ok: boolean; text: string } | null) => void;
  /** 点编辑：父组件打开编辑器（回填全文） */
  onEdit: (item: { id: string; content: string }) => void;
  /** 增删改后通知父组件刷新统计 */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ReflectionItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, string>>({}); // id → 全文
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      try {
        const r = await fetch(`/api/spaces/${spaceId}/reflections?limit=20&offset=${offset}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setTotal(j.total ?? 0);
        setItems((prev) => (offset === 0 ? (j.items as ReflectionItem[]) : [...(prev ?? []), ...(j.items as ReflectionItem[])]));
      } catch (e) {
        notify({ ok: false, text: `感悟加载失败：${e instanceof Error ? e.message : e}` });
      }
    },
    [spaceId, notify],
  );

  useEffect(() => {
    setItems(null);
    setExpanded({});
    void load(0);
  }, [load]);

  async function toggleExpand(it: ReflectionItem) {
    if (expanded[it.id] !== undefined) {
      setExpanded((s) => {
        const n = { ...s };
        delete n[it.id];
        return n;
      });
      return;
    }
    try {
      const r = await fetch(`/api/spaces/${spaceId}/reflections/${it.id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "加载失败");
      setExpanded((s) => ({ ...s, [it.id]: j.reflection.content }));
    } catch (e) {
      notify({ ok: false, text: `全文加载失败：${e instanceof Error ? e.message : e}` });
    }
  }

  async function remove(it: ReflectionItem) {
    if (!window.confirm(`删除这篇感悟？（${it.chars} 字）`)) return;
    const r = await fetch(`/api/spaces/${spaceId}/reflections/${it.id}`, { method: "DELETE" });
    if (r.ok) {
      notify({ ok: true, text: "🗑 感悟已删除" });
      onChanged();
      await load(0);
    } else {
      notify({ ok: false, text: "删除失败" });
    }
  }

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <span className="text-base">📝</span> 感悟
          <span className="text-xs font-normal text-ink-dim">{total} 篇</span>
        </h2>
      </div>

      {items === null ? (
        <p className="py-4 text-center text-xs text-ink-dim">加载中…</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-dim">
          还没有感悟 —— 阶段心得、踩坑复盘、自我对话，写给未来某个时刻的自己
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((it) => {
              const full = expanded[it.id];
              const day = fmtDay(it.created_at);
              return (
                <li key={it.id} className="group rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-ink-faint">
                      {day} {fmtTime(it.created_at)}
                      {it.edited && <span className="ml-1.5">· 已编辑</span>}
                    </p>
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onEdit({ id: it.id, content: full ?? "" })
                        }
                        title="编辑（打开时拉取全文）"
                        className="row-actions-hidden hidden rounded px-1.5 py-0.5 text-xs text-ink-mute hover:text-accent group-hover:block"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => void remove(it)}
                        title="删除"
                        className="row-actions-hidden hidden rounded px-1.5 py-0.5 text-xs text-ink-mute hover:text-danger group-hover:block"
                      >
                        🗑
                      </button>
                    </span>
                  </div>
                  <p
                    onClick={() => void toggleExpand(it)}
                    title="点击展开/收起全文"
                    className={`mt-1 cursor-pointer whitespace-pre-wrap text-xs leading-relaxed text-ink-soft ${full === undefined ? "line-clamp-4" : ""}`}
                  >
                    {full ?? it.preview}
                  </p>
                  <p className="mt-1 text-right text-[10px] text-ink-faint">{it.chars} 字{it.edited ? " · 已编辑" : ""}</p>
                </li>
              );
            })}
          </ul>
          {items.length < total && (
            <button
              onClick={async () => {
                setLoadingMore(true);
                await load(items.length);
                setLoadingMore(false);
              }}
              className="mt-3 w-full rounded-xl border border-line-soft py-2 text-xs text-ink-mute transition hover:text-accent"
            >
              {loadingMore ? "加载中…" : `加载更多（${total - items.length} 篇）`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
