"use client";

import { useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { moodEmoji, moodTone } from "@/lib/mood";
import { api } from "@/shared/api";
import { COMMON_MOODS } from "./kit";
import type { RunFn } from "./types";

interface MoodBlockProps {
  m: FeedMoment;
  run: RunFn;
}

/** 心情：可改可删（无心情且未打开选择器时整体不渲染） */
export function MoodBlock({ m, run }: MoodBlockProps) {
  const [moodPicker, setMoodPicker] = useState(false);

  if (!(m.mood || moodPicker)) return null;

  return (
    <div className="mt-1 text-xs">
      {moodPicker ? (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-elevated/60 p-2">
          {COMMON_MOODS.map((w) => (
            <button
              key={w}
              onClick={() =>
                run(async () => {
                  await api(`/api/feed/${m.id}`, "PATCH", { mood: w });
                  return `${moodEmoji(w)} 心情已改为「${w}」`;
                }).then(() => setMoodPicker(false))
              }
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                m.mood === w ? "bg-sky-600 text-white" : "bg-soft/60 text-ink-soft hover:bg-strong"
              }`}
            >
              {moodEmoji(w)} {w}
            </button>
          ))}
          <button
            onClick={() =>
              run(async () => {
                await api(`/api/feed/${m.id}`, "PATCH", { mood: null });
                return "已清除心情";
              }).then(() => setMoodPicker(false))
            }
            className="rounded-full px-2 py-0.5 text-[11px] text-danger hover:bg-rose-500/20"
          >
            清除
          </button>
          <button onClick={() => setMoodPicker(false)} className="ml-auto px-1 text-[11px] text-ink-dim">
            取消
          </button>
        </div>
      ) : (
        <p className={`group/mood flex items-center gap-1.5 ${moodTone(m.mood_score)}`}>
          <span>{moodEmoji(m.mood)} 此刻心情：{m.mood}</span>
          <button
            onClick={() => setMoodPicker(true)}
            className="row-actions-hidden hidden text-[11px] text-ink-dim hover:text-accent group-hover/mood:inline"
          >
            改
          </button>
        </p>
      )}
    </div>
  );
}
