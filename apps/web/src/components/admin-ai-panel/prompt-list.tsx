"use client";

import type { PromptItem } from "./types";

interface Props {
  items: PromptItem[];
  selKey: string | null | undefined;
  onPick: (item: PromptItem) => void;
}

/** prompt 清单：分类分组 + 覆盖态徽标；移动端横滑、PC 左栏 */
export default function PromptList({ items, selKey, onPick }: Props) {
  const categories: PromptItem["category"][] = ["识别", "复盘", "目标", "系统"];
  return (
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
                onClick={() => onPick(it)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs transition-all duration-200 lg:w-full ${
                  selKey === it.key
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
  );
}
