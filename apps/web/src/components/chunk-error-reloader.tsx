"use client";

import { useEffect } from "react";

/**
 * 部署换血自愈 v2（REQ-002 期间用户实测反馈加强）：
 * ① 双 tar 部署替换产物后，已打开的旧会话按旧清单懒加载路由 chunk / RSC 资源 → 404。
 *    Next 路由内部的这类失败常以裸 "Failed to fetch" 冒出（未必带 chunk 字样），故特征从宽。
 * ② 兜底看守：路由级 loading 兜底（loading.tsx 的 animate-pulse「正在加载拾光…」）连续可见
 *    超过 20s = 切换卡死 → 自动刷新一次。
 * 守卫：60s 窗口内最多自愈一次（sessionStorage），防失败循环；跨部署可反复触发。
 */
const FLAG = "shiguang_chunk_reloaded_at";
const WINDOW_MS = 60_000;
const STUCK_MS = 20_000;

const isRecoverable = (m: string) =>
  /Failed to fetch|dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|load failed/i.test(m);

function guardedReload(): boolean {
  const last = Number(sessionStorage.getItem(FLAG) || 0);
  if (Date.now() - last < WINDOW_MS) return false;
  sessionStorage.setItem(FLAG, String(Date.now()));
  location.reload();
  return true;
}

export default function ChunkErrorReloader() {
  useEffect(() => {
    const maybeReload = (raw: string) => {
      if (isRecoverable(raw)) guardedReload();
    };
    const onErr = (e: ErrorEvent) => maybeReload(e.message || "");
    const onRej = (e: PromiseRejectionEvent) =>
      maybeReload(String(e.reason?.message ?? e.reason ?? ""));

    // 卡死看守：路由 loading 兜底连续可见 STUCK_MS → 视为切换卡死，自愈刷新
    let stuckSince = 0;
    const timer = window.setInterval(() => {
      const el = document.querySelector("main p.animate-pulse");
      const stuck = !!el && (el.textContent || "").includes("加载");
      if (stuck) {
        if (!stuckSince) stuckSince = Date.now();
        else if (Date.now() - stuckSince > STUCK_MS) {
          if (guardedReload()) stuckSince = 0; // 刷新触发；60s 窗口内拒绝则保留计时，窗口过后再刷
        }
      } else {
        stuckSince = 0;
      }
    }, 3_000);

    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
