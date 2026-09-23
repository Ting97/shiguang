"use client";

import { useState } from "react";
import { TagChip } from "@/components/tag-chip";
import type { CategoryGroup } from "./types";

/**
 * ===== 数据面 · 区块 1：类别清单（REQ-005 FR-5.1）=====
 * 按域折叠展示：domain/name 标题 + source 小字 + values chips（首个分组默认展开）。
 */
export default function CategoryGroups({ groups }: { groups: CategoryGroup[] }) {
  const [openDomains, setOpenDomains] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].domain] : []));

  const toggle = (domain: string) =>
    setOpenDomains((s) => {
      const next = new Set(s);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  return (
    <ul className="space-y-1.5">
      {groups.map((g) => {
        const on = openDomains.has(g.domain);
        return (
          <li key={g.domain} className="rounded-xl border border-line-soft bg-bg/30">
            <button
              onClick={() => toggle(g.domain)}
              title={on ? "点击折叠" : "点击展开"}
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
            >
              <span className={`text-[10px] text-ink-faint transition-transform ${on ? "rotate-90" : ""}`}>▶</span>
              <span className="text-xs font-medium text-ink">{g.name}</span>
              <TagChip label={g.domain} tone="slate" size="sm" />
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink-faint" title={g.items.source}>
                {g.items.source}
              </span>
              <span className="shrink-0 tabular-nums text-[10px] text-ink-faint">{g.items.values.length} 项</span>
            </button>
            {on && (
              <div className="flex flex-wrap gap-1 px-3 pb-2.5">
                {g.items.values.map((v, i) => (
                  <TagChip key={`${v}-${i}`} label={v} tone="sky" size="sm" />
                ))}
                {g.items.values.length === 0 && <span className="text-[10px] text-ink-faint">（暂无数据）</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
