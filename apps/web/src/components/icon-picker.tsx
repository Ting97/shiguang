"use client";

import { useState } from "react";

/** 分类图标候选（emoji 网格，按主题分组） */
const ICON_GROUPS: Array<[string, string[]]> = [
  ["预设", ["😴", "💼", "📚", "💪", "👥", "🎮", "🧹", "🚌", "📌"]],
  ["运动", ["🏃", "🚴", "🏊", "🧘", "⚽", "🏀", "🎾", "🥊", "🤸"]],
  ["学习", ["✍️", "🧠", "💻", "📖", "✏️", "🔍", "🎓", "🔬", "🧩"]],
  ["生活", ["🍳", "🍜", "☕", "🛒", "🧺", "🛏️", "🚿", "🌱", "🐶", "🐱"]],
  ["娱乐", ["🎬", "🎵", "📺", "📱", "🎨", "🎲", "🎣", "📷", "🎈", "🀄"]],
  ["社交", ["❤️", "🎁", "🍻", "☎️", "💬", "🎉", "👨‍👩‍👧", "🤝", "🫶"]],
  ["出行", ["✈️", "🚗", "🚕", "🚲", "🗺️", "🏔️", "🏖️", "🏕️"]],
  ["健康", ["💊", "🩺", "🌿", "🫁", "🦷", "👁️"]],
  ["其他", ["⭐", "🔥", "💰", "🧾", "⏰", "🌙", "☀️", "🎯", "🛠️", "💡"]],
];

/** 图标选择器：点击展开 emoji 网格；支持自定义输入任意字符 */
export default function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="点击选择图标"
        className="flex h-9 w-12 items-center justify-center rounded border border-slate-600 bg-slate-900 text-base hover:border-sky-500"
      >
        {value || "🏷"}
      </button>
      {open && (
        <>
          {/* 点击空白处关闭 */}
          <button type="button" aria-label="关闭" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-10 z-30 max-h-[65vh] w-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
            {ICON_GROUPS.map(([group, icons]) => (
              <div key={group} className="mb-1.5 last:mb-0">
                <p className="mb-1 text-[10px] text-slate-500">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {icons.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => {
                        onChange(ic);
                        setOpen(false);
                      }}
                      className={`flex h-8 w-8 items-center justify-center rounded text-base hover:bg-slate-700 ${
                        value === ic ? "bg-sky-600/80 ring-1 ring-sky-400" : ""
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1 border-t border-slate-800 pt-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && custom.trim()) {
                    onChange([...custom.trim()][0] ?? custom.trim());
                    setCustom("");
                    setOpen(false);
                  }
                  e.stopPropagation();
                }}
                placeholder="自定义：粘贴 emoji 后回车"
                className="flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </>
      )}
    </span>
  );
}
