import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail } from "../src/server/identity/email.js";

test("邮箱格式：常规地址通过", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("u.ser+tag@sub.example.cn"), true);
});

test("邮箱格式：残缺/非法一律拒绝", () => {
  for (const bad of ["", "plain", "a@b", "@x.com", "a@.cn", "a b@x.com", "a@x.c"]) {
    assert.equal(isValidEmail(bad), false, bad);
  }
});
