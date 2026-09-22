import { test } from "node:test";
import assert from "node:assert/strict";
import { isProValid, FREE_AI_CALLS_30D } from "../src/server/ai/quota.js";

test("Pro 有效性：无到期时间 = 永久有效", () => {
  assert.equal(isProValid("pro", null), true);
});

test("Pro 有效性：未过期有效 / 已过期回落 free", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(isProValid("pro", future), true);
  assert.equal(isProValid("pro", past), false);
});

test("free 套餐永远不是 Pro", () => {
  assert.equal(isProValid("free", null), false);
  assert.equal(isProValid("free", new Date(Date.now() + 86_400_000).toISOString()), false);
});

test("免费额度常量为正且合理（防误改）", () => {
  assert.ok(Number.isInteger(FREE_AI_CALLS_30D) && FREE_AI_CALLS_30D > 0 && FREE_AI_CALLS_30D <= 1000);
});
