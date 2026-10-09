/**
 * 拾光 PWA Service Worker（REQ-009 FR-B8）：
 * - 导航请求（页面）：network-first，失败回缓存首页（离线可开壳）
 * - /api/*：network-first（数据要新），失败回最近缓存副本
 * - 静态资源（_next/static、icons、字体）：cache-first（文件名带 hash，天然不可变）
 * 发布更新：CACHE_VERSION 变更 → 旧缓存整体清除；跳过等待让新 SW 立即接管。
 * 注意：静态导出无构建期 precache 清单，采用运行时缓存策略（首访后具备离线能力）。
 */
const CACHE_VERSION = "shiguang-v1";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：network-first，离线回缓存首页
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL))),
    );
    return;
  }

  // API：network-first，失败回最近副本（只缓存 200 JSON）
  // 例外：/api/export 是全量个人数据备份（高敏大 payload），不落 Cache Storage（共用设备可离线读取）
  if (url.pathname.startsWith("/api/export")) {
    event.respondWith(fetch(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // 静态资源：cache-first（不可变文件名 + icons）
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
