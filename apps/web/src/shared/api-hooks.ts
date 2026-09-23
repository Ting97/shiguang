"use client";

/**
 * useApi（REQ-004 FR-E1.1 / 4-F）：轻量取数 hook——loading/error/data + refresh + 竞态防护。
 * 不引库（40 行内）；出现 5+ 页面需要缓存/重验证时再评估 SWR（决策点见 004 02 §7.1）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useApi<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async () => {
    if (path === null) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const parts = path.split(" ");
      const d = await api<T>(parts[0], parts[1] ?? "GET", parts[2] ? JSON.parse(parts[2]) : undefined);
      if (seq.current === my) setData(d);
    } catch (e) {
      if (seq.current === my) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refresh: run };
}
