"use client";

import { useMemo } from "react";
import type { FeedMoment } from "@/lib/types";
import { FEED_PAGE_SIZE_HINT, zhRecordTime } from "./moment-feed/kit";
import MomentCard from "./moment-feed/moment-card";
import type { MomentFeedProps } from "./moment-feed/types";

// 拆分后保留原有具名导出（entry-menu 等处仍从本路径引用）
export { COMMON_MOODS, DOMAIN_LABELS, zhRecordTime } from "./moment-feed/kit";

/** 动态流：按天分组（今天/昨天/历史日期），组内时间线 + 记录时刻贴合节点 */
export default function MomentFeed(props: MomentFeedProps) {
  const groups = useMemo(() => {
    const map = new Map<string, FeedMoment[]>();
    for (const m of props.moments) {
      const key = zhRecordTime(m.created_at).day;
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    return [...map.entries()];
  }, [props.moments]);

  if (props.moments.length === 0) {
    return (
      <p className="empty-state">
        {props.searching
          ? `没有找到包含「${props.searchKeyword}」的动态 —— 换个关键词，或点 ✕ 清除搜索`
          : "还没有动态 —— 随口说一句今天的事、心情或明天的计划试试"}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="sticky top-14 z-30 -mx-1 mb-2 bg-gradient-to-b from-bg via-bg/95 to-transparent px-1 pb-1 text-xs font-medium text-ink-dim">
            — {day} —
          </h3>
          <div className="relative space-y-3">
            {items.map((m, idx) => {
              const t = zhRecordTime(m.created_at);
              const isLast = idx === items.length - 1;
              return (
                <div key={m.id} className="relative flex items-start gap-2 sm:gap-2.5">
                  {/* 连接线：从本节点延伸到下一个节点（末条不画，避免悬空） */}
                  {!isLast && (
                    <span className="absolute left-[8px] top-[42px] -bottom-3 w-px bg-gradient-to-b from-sky-500/40 to-indigo-500/15 sm:left-[10.5px]" />
                  )}
                  <span className="absolute left-[4px] top-8 z-10 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-sky-400 to-indigo-400 shadow-[0_0_10px_rgba(56,189,248,0.6)] sm:left-[6px] sm:h-2.5 sm:w-2.5" />
                  {/* 记录时刻：桌面在卡片外节点旁；移动端窄屏隐藏（时刻移入卡片头部，把宽度还给正文） */}
                  <div className="ml-[14px] hidden w-12 shrink-0 pt-7 text-left leading-tight sm:ml-[18px] sm:block">
                    <div className="text-xs tabular-nums text-ink-mute">{t.clock}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 pl-1 text-[11px] tabular-nums text-ink-dim sm:hidden">{t.clock}</div>
                    <MomentCard m={m} {...props} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* 分页：每次多加载一页 */}
      {(props.moreCount ?? 0) > 0 && props.onLoadMore ? (
        <div className="pt-1 text-center">
          <button
            onClick={props.onLoadMore}
            disabled={props.loadingMore}
            className="rounded-full border border-line-soft bg-surface/60 px-5 py-2 text-xs text-accent transition hover:border-sky-500/50 hover:text-accent disabled:opacity-50"
          >
            {props.loadingMore ? "加载中…" : `加载更多（还有 ${props.moreCount} 条）`}
          </button>
        </div>
      ) : (
        props.moments.length >= FEED_PAGE_SIZE_HINT && (
          <p className="pt-1 text-center text-[11px] text-ink-dim">— 已经到底啦 —</p>
        )
      )}
    </div>
  );
}
