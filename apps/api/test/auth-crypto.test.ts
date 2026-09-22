import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, generateSessionToken, hashToken,
  generateSmsCode, generateInviteCode, isValidPhone,
} from "../src/server/identity/auth-crypto.js";

test("密码哈希：正确密码通过、错误密码拒绝", () => {
  const stored = hashPassword("hunter2安全密码");
  assert.notEqual(stored, "hunter2安全密码");
  assert.ok(stored.startsWith("scrypt$16384$"));
  assert.equal(verifyPassword("hunter2安全密码", stored), true);
  assert.equal(verifyPassword("wrong", stored), false);
});

test("密码哈希：同密码两次哈希不同（随机盐）、互相可验证", () => {
  const a = hashPassword("same-pass");
  const b = hashPassword("same-pass");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same-pass", a), true);
  assert.equal(verifyPassword("same-pass", b), true);
});

test("密码哈希：畸形存储串安全返回 false", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "bcrypt$abc"), false);
  assert.equal(verifyPassword("x", "scrypt$abc$def"), false);
});

test("会话 token：256bit 随机、不重复", () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test("token 哈希：确定性、不可逆推原文长度", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
  assert.equal(hashToken("abc").length, 64);
});

test("短信验证码：6 位数字", () => {
  for (let i = 0; i < 20; i++) assert.match(generateSmsCode(), /^\d{6}$/);
});

test("邀请码：8 位、字符集不含易混淆字符", () => {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode();
    assert.equal(code.length, 8);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test("手机号校验", () => {
  assert.equal(isValidPhone("13812345678"), true);
  assert.equal(isValidPhone("19912345678"), true);
  assert.equal(isValidPhone("12812345678"), false);
  assert.equal(isValidPhone("1381234567"), false);
  assert.equal(isValidPhone("138123456789"), false);
  assert.equal(isValidPhone(""), false);
});
