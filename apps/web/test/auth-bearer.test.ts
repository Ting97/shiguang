import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBearerToken } from "../src/lib/bearer.js";
import { generateSessionToken } from "../src/lib/auth-crypto.js";
import { resolveCors } from "../src/lib/cors.js";

function req(method: string, headers: Record<string, string>) {
  return { method, headers: new Headers(headers) };
}

test("Bearer 解析：合法 64 位 hex token 提取成功", () => {
  const token = generateSessionToken(); // 32 字节 = 64 hex
  assert.equal(extractBearerToken(`Bearer ${token}`), token);
});

test("Bearer 解析：大小写不敏感的 Bearer 前缀与 hex 归一化", () => {
  const token = "A".repeat(64);
  assert.equal(extractBearerToken(`bearer ${token.toLowerCase()}`), token.toLowerCase());
  assert.equal(extractBearerToken(`BEARER   ${token}`), token.toLowerCase());
});

test("Bearer 解析：非法形态一律 null（不抛错）", () => {
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken("Bearer abc"), null); // 非 64 hex
  assert.equal(extractBearerToken(`Bearer ${"g".repeat(64)}`), null); // 非 hex 字符
  assert.equal(extractBearerToken(`Bearer ${"a".repeat(63)}`), null); // 长度不符
  assert.equal(extractBearerToken("Basic dXNlcjpwYXNz"), null); // 其他 scheme
});

test("CORS：无 Origin 的同域请求不加任何头、不拦截", () => {
  const d = resolveCors(req("GET", {}));
  assert.equal(d.preflight, false);
  assert.deepEqual(d.headers, {});
});

test("CORS：Capacitor 白名单 origin 回显，预检返回方法/头清单", () => {
  for (const origin of ["capacitor://localhost", "https://localhost", "http://localhost"]) {
    const pre = resolveCors(req("OPTIONS", { Origin: origin }));
    assert.equal(pre.preflight, true);
    assert.equal(pre.headers["Access-Control-Allow-Origin"], origin);
    assert.ok(pre.headers["Access-Control-Allow-Methods"].includes("POST"));
    assert.ok(pre.headers["Access-Control-Allow-Headers"].includes("Authorization"));
    assert.equal(pre.headers["Access-Control-Max-Age"], "86400");

    const actual = resolveCors(req("POST", { Origin: origin, Authorization: `Bearer ${"a".repeat(64)}` }));
    assert.equal(actual.preflight, false);
    assert.equal(actual.headers["Access-Control-Allow-Origin"], origin);
    assert.equal(actual.headers["Access-Control-Allow-Credentials"], undefined); // 反射 origin 时绝不带凭证位
  }
});

test("CORS：携带 Bearer 的任意 origin 动态放行（Expo 开发态）", () => {
  const origin = "exp://192.168.1.5:8081";
  const d = resolveCors(req("GET", { Origin: origin, Authorization: `Bearer ${"b".repeat(64)}` }));
  assert.equal(d.preflight, false);
  assert.equal(d.headers["Access-Control-Allow-Origin"], origin);
  const pre = resolveCors(req("OPTIONS", { Origin: origin, Authorization: `Bearer ${"b".repeat(64)}` }));
  assert.equal(pre.preflight, true);
  assert.equal(pre.headers["Access-Control-Allow-Origin"], origin);
});

test("CORS：未带凭证的未知 origin 一律拒绝（不回显）", () => {
  for (const h of [
    { Origin: "https://evil.example" },
    { Origin: "https://evil.example", Authorization: "Basic xxx" },
    { Origin: "null" },
  ]) {
    const d = resolveCors(req("GET", h));
    assert.equal(d.preflight, false);
    assert.deepEqual(d.headers, {});
  }
});
