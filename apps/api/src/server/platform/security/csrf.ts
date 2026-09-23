/**
 * CSRF 硬校验（REQ-004 FR-C2.2 / 决策 02 §5.3）：不用 double-submit token，改为
 * Cookie 会话的写请求强制校验 Origin / Sec-Fetch-Site（现代浏览器 100% 带），两者皆缺拒绝。
 * Bearer 请求豁免（原生端无 Cookie 面）。挂在 middleware 层集中生效，未迁移路由全覆盖。
 */

/** 校验写请求来源；通过返回 null，不通过返回拒绝原因 */
export function verifyWriteOrigin(
  method: string,
  headers: { origin: string | null; secFetchSite: string | null },
  hostCandidates: (string | null)[],
): "ok" | "no-origin-proof" | "cross-origin" {
  const safe = ["GET", "HEAD", "OPTIONS"];
  if (safe.includes(method.toUpperCase())) return "ok";

  // Host 头归一化取 hostname：手写 split(":") 对 IPv6 字面量（[::1]:3000）会切出 "["，永不相等 → 误判 cross-origin
  const hosts = hostCandidates
    .filter((h): h is string => Boolean(h))
    .map((h) => {
      try {
        return new URL(`http://${h.trim()}`).hostname.toLowerCase();
      } catch {
        return h.toLowerCase().split(":")[0];
      }
    });
  const site = headers.secFetchSite?.toLowerCase();
  if (site) {
    // same-site 允许同站兄弟域也会带 cookie，收紧为 same-origin/none
    if (site === "same-origin" || site === "none") return "ok";
    return "cross-origin";
  }
  if (headers.origin) {
    try {
      const originHost = new URL(headers.origin).hostname.toLowerCase();
      if (hosts.includes(originHost)) return "ok";
      return "cross-origin";
    } catch {
      return "cross-origin";
    }
  }
  // 现代浏览器写请求必带二者之一；皆缺视为非浏览器伪造
  return "no-origin-proof";
}
