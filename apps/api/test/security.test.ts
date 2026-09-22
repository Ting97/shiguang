/** 4-B 安全件单测：滑动窗口限流 + CSRF 写校验（纯函数/内存态，无 DB） */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { hitRateLimit, resetRateLimits } from "../src/server/platform/security/rate-limit";
import { verifyWriteOrigin } from "../src/server/platform/security/csrf";

test("限流：窗口内超过上限即 blocked，窗口滑动后解封", () => {
  resetRateLimits();
  let now = 1_000_000;
  mock.method(Date, "now", () => now);
  try {
    for (let i = 0; i < 20; i++) {
      const r = hitRateLimit("login:ip:1.2.3.4", 15 * 60_000, 20);
      assert.equal(r.blocked, false, `第 ${i + 1} 次不应封禁`);
    }
    const blocked = hitRateLimit("login:ip:1.2.3.4", 15 * 60_000, 20);
    assert.equal(blocked.blocked, true, "第 21 次应封禁");
    assert.ok(blocked.retryAfterMs > 0);
    // 滑过窗口 → 解封
    now += 15 * 60_000 + 1;
    const freed = hitRateLimit("login:ip:1.2.3.4", 15 * 60_000, 20);
    assert.equal(freed.blocked, false, "窗口滑过后应解封");
  } finally {
    mock.restoreAll();
  }
});

test("限流：不同键互不影响", () => {
  resetRateLimits();
  for (let i = 0; i < 25; i++) hitRateLimit("k1", 60_000, 25);
  assert.equal(hitRateLimit("k1", 60_000, 25).blocked, true);
  assert.equal(hitRateLimit("k2", 60_000, 25).blocked, false);
});

test("CSRF：Sec-Fetch-Site 优先——same-origin 放行、cross-site 拒绝", () => {
  const hosts = ["shiguang.ting97.cn", "127.0.0.1:3000"];
  assert.equal(verifyWriteOrigin("POST", { origin: "https://evil.example", secFetchSite: "same-origin" }, hosts), "ok");
  assert.equal(verifyWriteOrigin("POST", { origin: "https://shiguang.ting97.cn", secFetchSite: "cross-site" }, hosts), "cross-origin");
});

test("CSRF：无 Sec-Fetch-Site 时回退 Origin 白名单（host 比对含端口剥离）", () => {
  const hosts = ["shiguang.ting97.cn", "localhost"];
  assert.equal(verifyWriteOrigin("PATCH", { origin: "https://shiguang.ting97.cn", secFetchSite: null }, hosts), "ok");
  assert.equal(verifyWriteOrigin("PATCH", { origin: "http://localhost:3000", secFetchSite: null }, hosts), "ok");
  assert.equal(verifyWriteOrigin("DELETE", { origin: "https://evil.example", secFetchSite: null }, hosts), "cross-origin");
  assert.equal(verifyWriteOrigin("POST", { origin: "not-a-url", secFetchSite: null }, hosts), "cross-origin");
});

test("CSRF：二者皆缺的写请求拒绝；GET/HEAD/OPTIONS 恒放行", () => {
  const hosts = ["shiguang.ting97.cn"];
  assert.equal(verifyWriteOrigin("POST", { origin: null, secFetchSite: null }, hosts), "no-origin-proof");
  assert.equal(verifyWriteOrigin("GET", { origin: null, secFetchSite: null }, hosts), "ok");
  assert.equal(verifyWriteOrigin("OPTIONS", { origin: "https://evil.example", secFetchSite: null }, hosts), "ok");
});
