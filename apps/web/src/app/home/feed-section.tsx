"use client";

import type { Dispatch, SetStateAction } from "react";
import MomentFeed from "@/components/moment-feed";
import { FilterChip } from "@/components/tag-chip";
import type { Activity, FeedMoment, Space } from "@/lib/types";

interface Props {
  moments: FeedMoment[];
  activities: Activity[];
  feedTotal: number;
  query: string;
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  spaces: Space[];
  spaceFilter: string;
  onSpaceChange: (id: string) => void;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => Promise<void>;
}

/** 动态流：每条记录都是一条动态（记录时刻 + AI 识别结果，均可修改/删除）；含搜索框与空间切换条 */
export default function FeedSection({
  moments,
  activities,
  feedTotal,
  query,
  searchInput,
  setSearchInput,
  spaces,
  spaceFilter,
  onSpaceChange,
  loadingMore,
  onLoadMore,
  onRefresh,
}: Props) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-ink-soft">
          🌱 我的动态{" "}
          <span className="ml-1 text-xs font-normal text-ink-dim">
            {query
              ? `找到 ${feedTotal} 条`
              : feedTotal > 0
                ? `共 ${feedTotal} 条${feedTotal > moments.length ? ` · 已显示 ${moments.length} 条` : " · 悬停卡片可修正识别"}`
                : ""}
          </span>
        </h2>
        <div className="relative w-full sm:w-64">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchInput("");
            }}
            placeholder="🔍 搜索：原文/日程/todo/金额/联系人"
            className="w-full rounded-xl border border-line-soft bg-surface/60 py-1.5 pl-3 pr-8 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500/60"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              title="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-dim hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {/* 空间切换条：全部 / 未归属 / 各 active 空间（有归属数据才显示） */}
      {(spaces.length > 0 || moments.some((m) => m.space)) && (
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip
            variant="filter"
            active={spaceFilter === "all"}
            label="全部"
            onClick={() => onSpaceChange("all")}
          />
          <FilterChip
            variant="filter"
            active={spaceFilter === "none"}
            label="未归属"
            onClick={() => onSpaceChange("none")}
          />
          {spaces.map((s) => (
            <FilterChip
              key={s.id}
              variant="filter"
              active={spaceFilter === s.id}
              icon={<span className="text-[12px] leading-none">{s.icon}</span>}
              label={s.name}
              onClick={() => onSpaceChange(s.id)}
            />
          ))}
        </div>
      )}
      <MomentFeed
        moments={moments}
        activities={activities}
        onRefresh={onRefresh}
        moreCount={Math.max(0, feedTotal - moments.length)}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        searching={!!query}
        searchKeyword={query}
      />
    </section>
  );
}
