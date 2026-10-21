/* global Headers, Response */
/**
 * 拾光 PWA Service Worker（REQ-009 FR-B8）：
 * - 导航请求（页面）：network-first，失败回缓存首页（离线可开壳）
 * - /api/*：network-first（数据要新），失败回最近缓存副本（带 24h TTL + 条目上限）
 * - 静态资源（_next/static、icons、字体）：cache-first（文件名带 hash，天然不可变）
 * 发布更新：CACHE_VERSION 变更 → 旧缓存整体清除；跳过等待让新 SW 立即接管。
 * 注意：静态导出无构建期 precache 清单，采用运行时缓存策略（首访后具备离线能力）。
 */
const CACHE_VERSION = "shiguang-v1";
const OFFLINE_URL = "/";
/* /api/* 缓存治理（十二轮检视）：无限增长 + 陈旧回放治理——
 * - TTL：缓存副本写入时间记在 sw-fetched-at 响应头，>24h 视为陈旧（写路径顺手清理）
 * - 上限：条目 >300 时按写入时间删最旧（LRU 近似）
 * - 易变查询跳过：q=/keyword= 自由文本搜索每个键入都产生新 URL，只增不命中，永不缓存
 * - 401 即清：会话被服务端吊销/过期时整缓存删除，防下一账号/下一会话读到上一账号个人数据 */
const API_TTL_MS = 24 * 3600_000;
const API_CACHE_MAX = 300;
const VOLATILE_API_PARAMS = ["q", "keyword"];

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
      .then(() => pruneApiCache())
      .then(() => self.clients.claim()),
  );
});

/* 登出清理（十一轮隐私修复）：/api/* 缓存含上一账号的个人数据（feed/contacts/finance…），
 * 页面登出时 postMessage 通知全量删除（静态资源下次访问重新回填，离线壳不受影响）。 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_USER_CACHE") {
    event.waitUntil(caches.delete(CACHE_VERSION));
  }
});

function isVolatileApi(url) {
  return VOLATILE_API_PARAMS.some((p) => url.searchParams.has(p));
}

/** TTL 过期 + 容量上限清理（尽力而为，失败不影响主流程） */
async function pruneApiCache() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    const keys = await cache.keys();
    const now = Date.now();
    const kept = [];
    for (const req of keys) {
      if (!new URL(req.url).pathname.startsWith("/api/")) continue;
      const res = await cache.match(req);
      const at = Number(res?.headers.get("sw-fetched-at") ?? 0);
      if (!at || now - at > API_TTL_MS) {
        await cache.delete(req);
        continue;
      }
      kept.push({ req, at });
    }
    if (kept.length > API_CACHE_MAX) {
      kept.sort((a, b) => a.at - b.at);
      for (const { req } of kept.slice(0, kept.length - API_CACHE_MAX)) await cache.delete(req);
    }
  } catch {
    /* 清理失败不阻断 */
  }
}

/** 缓存副本带写入时间戳（新 Response 重建以注入自定义头） */
async function putApiWithStamp(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set("sw-fetched-at", String(Date.now()));
  const body = await res.clone().arrayBuffer();
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
  pruneApiCache(); // 后台清理，不阻塞响应
}

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

  // API：network-first，失败回最近副本（只缓存 200 JSON；q=/keyword= 易变查询不落缓存）
  // 例外：/api/export 是全量个人数据备份（高敏大 payload），不落 Cache Storage（共用设备可离线读取）
  if (url.pathname.startsWith("/api/export")) {
    event.respondWith(fetch(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    const cacheable = !isVolatileApi(url);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 401) {
            // 会话失效：整缓存删除（上一会话的 feed/contacts/finance 个人数据不再可离线回放）
            event.waitUntil(caches.delete(CACHE_VERSION));
          } else if (res.ok && cacheable && res.headers.get("content-type")?.includes("application/json")) {
            event.waitUntil(
              caches.open(CACHE_VERSION).then((c) => putApiWithStamp(c, req, res)),
            );
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => {
            const at = Number(hit?.headers.get("sw-fetched-at") ?? 0);
            return hit && at && Date.now() - at <= API_TTL_MS ? hit : undefined;
          }),
        ),
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
