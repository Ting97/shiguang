"use client";

import { useEffect } from "react";

/**
 * 部署换血自愈：双 tar 部署替换 chunk 后，已打开的旧会话仍持旧路由清单，
 * 懒加载路由 chunk 会 404 并卡在路由 loading 兜底（只能手动强刷）。
 * 这里监听 chunk 加载失败特征并自动 location.reload() 一次——刷新后拿到新 HTML/新清单即自愈。
 * 60 秒窗口内最多自愈一次（sessionStorage 守卫），防失败循环；跨部署可反复触发。
 */
const FLAG = "shiguang_chunk_reloaded_at";
const WINDOW_MS = 60_000;

const isChunkErr = (m: string) =>
  /Failed to fetch dynamically imported module|Loading chunk \d+ failed|error loading dynamically imported module|ChunkLoadError/i.test(m);

export default function ChunkErrorReloader() {
  useEffect(() => {
    const maybeReload = (raw: string) => {
      if (!isChunkErr(raw)) return;
      const last = Number(sessionStorage.getItem(FLAG) || 0);
      if (Date.now() - last < WINDOW_MS) return;
      sessionStorage.setItem(FLAG, String(Date.now()));
      location.reload();
    };
    const onErr = (e: ErrorEvent) => maybeReload(e.message || "");
    const onRej = (e: PromiseRejectionEvent) =>
      maybeReload(String(e.reason?.message ?? e.reason ?? ""));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
