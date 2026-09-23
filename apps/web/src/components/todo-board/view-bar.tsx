"use client";

import { FilterChip } from "../tag-chip";
import { VIEWS } from "./kit";
import type { View } from "./types";

/**
 * 智能列表 chips（拆分自 todo-board，行为零变化）：
 * 移动端横滑 / PC 侧栏两种形态；chipRefs 仅横滑态收集，供入口在切视图后把激活 chip 滚入视野。
 */
export function ViewBar({
  vertical,
  view,
  counts,
  onSelect,
  chipRefs,
}: {
  vertical: boolean;
  view: View;
  counts: Record<View, number>;
  onSelect: (v: View) => void;
  chipRefs?: { current: Record<View, HTMLButtonElement | null> };
}) {
  return (
    <>
      {VIEWS.map(([v, label]) => (
        <FilterChip
          key={v}
          label={label}
          count={counts[v]}
          active={view === v}
          vertical={vertical}
          onClick={() => onSelect(v)}
          chipRef={
            vertical
              ? undefined
              : (el) => {
                  if (chipRefs) chipRefs.current[v] = el;
                }
          }
        />
      ))}
    </>
  );
}
