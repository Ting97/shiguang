"use client";

import { useEffect, useState } from "react";
import { api } from "@/shared/api";

export interface CachedReview {
  summary: string;
  sections?: { title: string; text: string }[];
  highlights: string[];
  suggestions: string[];
}

/** 挂载/周期切换时只读拉取已持久化的小结（GET /api/review，不触发生成、不耗次数） */
export function useCachedReview(kind: "day" | "week" | "month" | "year", period: string | undefined) {
  const [cached, setCached] = useState<CachedReview | null>(null);
  useEffect(() => {
    let alive = true;
    setCached(null);
    if (!period) return;
    api(`/api/review?kind=${kind}&period=${period}`)
      .then((j) => {
        if (alive && j?.review) setCached(j.review as CachedReview);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind, period]);
  return cached;
}
