/** 十五轮检视：parseResponse 的 200+非JSON 吞成空对象成功（静默假成功）——补解析失败显式抛错 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { api, ApiClientError, memoryTokenStore, setTokenStore } from "../src/client-api.js";

// 走内存 token store，避免依赖 localStorage（node 环境无）
setTokenStore(memoryTokenStore);

test("api：200 + 非 JSON 体显式报错，不再吞成空对象假成功", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response("<html>login page</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
  );
  try {
    await assert.rejects(
      api("/api/anything"),
      (e: unknown) => e instanceof ApiClientError && e.status === 200,
    );
  } finally {
    mock.restoreAll();
  }
});

test("api：200 + 合法空对象不受影响（回归）；错误响应口径不变", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  try {
    assert.deepEqual(await api("/api/anything"), {});
  } finally {
    mock.restoreAll();
  }

  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "参数错误" }), { status: 400, headers: { "Content-Type": "application/json" } }),
  );
  try {
    await assert.rejects(
      api("/api/anything"),
      (e: unknown) => e instanceof ApiClientError && e.status === 400 && e.message === "参数错误",
    );
  } finally {
    mock.restoreAll();
  }
});
