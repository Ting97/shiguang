"use client";

import { Link2, Sprout } from "lucide-react";
import { useEffect, useState } from "react";
import { TagChip } from "@/components/tag-chip";
import type { FeedMoment } from "@/lib/types";
import type { MomentLinkActions } from "./use-moment-link";

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → 北京时间 M/D HH:mm（toLocaleString 依赖设备时区，收敛为 UTC getter + 8h 的显式格式化） */
const bjStamp = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 关联动态区块（自 detail.tsx 拆出）：相关动态列表 + 关联动态入口 + 加载更多分页 */
export default function MomentsSection(opts: {
  moments: FeedMoment[];
  /** 该空间动态总数（feed 接口 total；null=未知，不显示进度） */
  total: number | null;
  loadingMore: boolean;
  /** 返回是否还有更多（false = 已到底） */
  onLoadMore: () => Promise<boolean>;
  momentLink: MomentLinkActions;
}) {
  const { moments, total, loadingMore, onLoadMore, momentLink } = opts;
  const { openMomentLink } = momentLink;
  const [exhausted, setExhausted] = useState(false);
  // 关联新动态后 load() 会把 moments 重置回第一页：exhausted 不复位会让「加载更多」永久消失
  useEffect(() => {
    if (exhausted && (total == null || moments.length < total)) setExhausted(false);
  }, [exhausted, total, moments.length]);
  const hasMore = !exhausted && (total == null || moments.length < total);
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <TagChip icon={<Sprout size={12} />} label="相关动态" tone="emerald" />
        <span className="text-xs font-normal text-ink-dim">{moments.length} 条</span>
        <button
          onClick={openMomentLink}
          className="ml-auto flex items-center gap-1 rounded-lg border border-line-soft px-2.5 py-1 text-micro font-normal text-ink-mute transition hover:border-emerald-500/50 hover:text-accent"
        >
          <Link2 size={12} aria-hidden /> 关联动态
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
              <p className="text-badge text-ink-faint">{bjStamp(m.created_at)}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{m.raw_text}</p>
            </li>
          ))}
        </ul>
      )}
      {moments.length > 0 && hasMore && (
        <button
          onClick={async () => {
            const more = await onLoadMore();
            if (!more) setExhausted(true);
          }}
          disabled={loadingMore}
          className="mt-3 min-h-[44px] w-full rounded-xl border border-line-soft text-xs text-ink-mute transition hover:border-emerald-500/40 hover:text-accent disabled:opacity-50"
        >
          {loadingMore ? "加载中…" : total != null ? `加载更多（已看 ${moments.length} / 共 ${total} 条）` : "加载更多"}
        </button>
      )}
      {moments.length > 0 && !hasMore && total != null && total > 20 && (
        <p className="mt-3 text-center text-micro text-ink-faint">已看完全部 {total} 条</p>
      )}
    </section>
  );
}
