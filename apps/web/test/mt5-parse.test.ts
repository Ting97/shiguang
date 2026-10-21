/**
 * MT5 报表时间解析回归（十二轮检视）：夏令时自动判定。
 * 旧版恒按 UTC+3 折算，夏令期（EU 规则 3 月末~10 月末）导入的开/平仓时间整体偏 1 小时。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMt5Time, mt5OffsetHours } from "../src/lib/mt5-parse";

test("mt5OffsetHours：冬令时（1 月）UTC+2", () => {
  assert.equal(mt5OffsetHours({ y: 2026, mo: 1, d: 15, h: 10, mi: 30 }), 2);
});

test("mt5OffsetHours：夏令时（7 月）UTC+3", () => {
  assert.equal(mt5OffsetHours({ y: 2026, mo: 7, d: 15, h: 10, mi: 30 }), 3);
});

test("mt5OffsetHours：切换边界——3 月最后周日 01:00 UTC 起进入 +3（2026-03-29）", () => {
  assert.equal(mt5OffsetHours({ y: 2026, mo: 3, d: 29, h: 0, mi: 59 }), 2);
  assert.equal(mt5OffsetHours({ y: 2026, mo: 3, d: 29, h: 1, mi: 0 }), 3);
});

test("mt5OffsetHours：切换边界——10 月最后周日 01:00 UTC 起回落 +2（2026-10-25）", () => {
  assert.equal(mt5OffsetHours({ y: 2026, mo: 10, d: 25, h: 0, mi: 59 }), 3);
  assert.equal(mt5OffsetHours({ y: 2026, mo: 10, d: 25, h: 1, mi: 0 }), 2);
});

test("parseMt5Time：夏令期时间按 +3 折算（旧版按 +3 恒定，冬令期偏 1 小时）", () => {
  // 夏令期 2026-07-01 22:05 EEST(+3) → UTC 19:05
  assert.equal(parseMt5Time("2026.07.01 22:05"), "2026-07-01T19:05:00.000Z");
  // 冬令期 2026-01-05 22:05 EET(+2) → UTC 20:05（旧版恒 +3 会错成 19:05）
  assert.equal(parseMt5Time("2026.01.05 22:05"), "2026-01-05T20:05:00.000Z");
});

test("parseMt5Time：显式 offsetHours 覆盖自动判定", () => {
  assert.equal(parseMt5Time("2026.07.01 22:05", 2), "2026-07-01T20:05:00.000Z");
});

test("parseMt5Time：非法输入回 null（原口径不变）", () => {
  assert.equal(parseMt5Time(""), null);
  assert.equal(parseMt5Time("2026-13-40 25:00"), null);
});
