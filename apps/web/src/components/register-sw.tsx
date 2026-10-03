"use client";

/**
 * Service Worker 注册（REQ-009 FR-B8）：仅生产注册；/dev/dist 下静默跳过。
 * sw.js 提供离线壳：静态资源 cache-first、API network-first、导航请求离线回缓存页。
 */
import { useEffect } from "react";

export default function RegisterSw() {
  useEffect(() => {
    // 生产 only：dev 环境（localhost）不注册，避免 SW 缓存开发资源
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return;
    if (!("serviceWorker" in navigator)) return;
    // 同源静态托管下固定路径；版本升级由 sw.js 内 CACHE 名变更驱动
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 注册失败不影响功能（无 SW = 无离线能力而已） */
    });
  }, []);
  return null;
}
