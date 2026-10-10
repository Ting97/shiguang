/**
 * 北京墙上时间工具（date.ts）检视修复回归：combineHM 非法输入不再抛 RangeError。
 * 契约背景：combineHM 原实现 setUTCHours(NaN) → Invalid Date → toISOString() 直接 throw，
 * 小程序编辑弹层里用户清空时刻提交就会拿到原始 RangeError。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { combineHM, combineHmEndCrossDay, isoToBjInput, zhTime } from "../src/date.js";

const ISO = "2026-10-08T04:30:00.000Z"; // 北京 12:30

test("combineHM：合法输入按北京钟面换 ISO（回归）", () => {
  assert.equal(combineHM(ISO, "09:05"), "2026-10-08T01:05:00.000Z");
  assert.equal(zhTime(combineHM(ISO, "23:59")), "23:59");
});

test("combineHM：空/残缺/越界输入保持原时刻（不再抛 Invalid time value）", () => {
  assert.equal(combineHM(ISO, ""), ISO);
  assert.equal(combineHM(ISO, "9"), ISO); // 缺分钟
  assert.equal(combineHM(ISO, "25:00"), ISO); // 越界小时
  assert.equal(combineHM(ISO, "12:60"), ISO); // 越界分钟
});

test("isoToBjInput：北京墙上输入值（回归）", () => {
  assert.equal(isoToBjInput(ISO), "2026-10-08T12:30");
  assert.equal(isoToBjInput(null), "");
});

test("combineHM：负数钟点保持原值（setUTCHours(-1) 回卷一天）", () => {
  const ISO = "2026-10-08T04:30:00.000Z";
  assert.equal(combineHM(ISO, "-1:30"), ISO);
  assert.equal(combineHM(ISO, "12:-5"), ISO);
  assert.equal(combineHM(ISO, "23:59") !== ISO, true); // 合法值仍正常换算
});

test("combineHmEndCrossDay：结束晚于开始同日", () => {
  // 北京 12:30 开始，结束 14:00 → 同日 06:00Z
  assert.equal(combineHmEndCrossDay(ISO, "14:00", ISO), "2026-10-08T06:00:00.000Z");
});

test("combineHmEndCrossDay：结束早于开始自动 +1 天（23:00–06:00 睡眠块）", () => {
  const start = "2026-10-08T15:00:00.000Z"; // 北京 23:00
  assert.equal(combineHmEndCrossDay(start, "06:00", start), "2026-10-08T22:00:00.000Z"); // 北京 10-09 06:00
});

test("combineHmEndCrossDay：结束等于开始也 +1 天（满 24h 块）", () => {
  assert.equal(combineHmEndCrossDay(ISO, "12:30", ISO), "2026-10-09T04:30:00.000Z");
});

test("combineHmEndCrossDay：非法 hm 回退原结束", () => {
  assert.equal(combineHmEndCrossDay(ISO, "", ISO), ISO);
  assert.equal(combineHmEndCrossDay(ISO, "25:00", ISO), ISO);
});
