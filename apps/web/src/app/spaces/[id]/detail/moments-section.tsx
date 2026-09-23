"use client";

import { TagChip } from "@/components/tag-chip";
import type { FeedMoment } from "@/lib/types";
import type { MomentLinkActions } from "./use-moment-link";

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → 北京时间 M/D HH:mm（toLocaleString 依赖设备时区，收敛为 UTC getter + 8h 的显式格式化） */
const bjStamp = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 关联动态区块（自 detail.tsx 拆出）：相关动态列表 + 关联动态入口 */
export default function MomentsSection(opts: {
  moments: FeedMoment[];
  momentLink: MomentLinkActions;
}) {
  const { moments, momentLink } = opts;
  const { openMomentLink } = momentLink;
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <TagChip icon="🌱" label="相关动态" tone="emerald" />
        <span className="text-xs font-normal text-ink-dim">{moments.length} 条</span>
        <button
          onClick={openMomentLink}
          className="ml-auto rounded-lg border border-line-soft px-2.5 py-1 text-[11px] font-normal text-ink-mute transition hover:border-emerald-500/50 hover:text-accent"
        >
          🔗 关联动态
        </button>
      </h2>
      {moments.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">
          还没有归属该空间的动态 —— 发布时 AI 会自动归类，也可在动态卡片菜单手动归属
        </p>
      ) : (
        <ul className="space-y-2">
          {moments.map((m) => (
            <li key={m.id} className="rounded-xl border border-line-soft bg-bg/30 px-3 py-2.5">
              <p className="text-[10px] text-ink-faint">{bjStamp(m.created_at)}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{m.raw_text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
