"use client";

import { useEffect } from "react";

/**
 * 部署换血自愈（REQ-002 期间用户实测反馈加强）：
 * 双 tar 部署替换产物后，已打开的旧会话按旧清单懒加载路由 chunk / RSC 资源 → 404。
 * Next 路由内部的这类失败常以裸 "Failed to fetch" 冒出（未必带 chunk 字样），故特征从宽。
 * （曾有按 loading.tsx 视觉特征判「卡死」的兜底看守，loading.tsx 改 skeleton 后特征失配已删；
 *   若要恢复需跟随 loading.tsx 的真实 DOM，勿凭旧文案猜测。）
 * 守卫：60s 窗口内最多自愈一次（sessionStorage），防失败循环；跨部署可反复触发。
 */
const FLAG = "shiguang_chunk_reloaded_at";
const WINDOW_MS = 60_000;

const isRecoverable = (m: string) =>
  /Failed to fetch|dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|load failed/i.test(m);

function guardedReload(): boolean {
  // Safari 锁定模式/隐私模式 sessionStorage 读写直接 throw：不包裹会让自愈逻辑在这些环境
  // 永久失效（且异常本身冒到全局 handler）；包 try-catch 降级为「无守卫直刷」（theme-toggle 同口径）
  try {
    const last = Number(sessionStorage.getItem(FLAG) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    /* 无存储可用：跳过守卫直接刷 */
  }
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

    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
