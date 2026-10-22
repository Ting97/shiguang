/**
 * 北京墙上时间工具（date.ts）检视修复回归：combineHM 非法输入不再抛 RangeError。
 * 契约背景：combineHM 原实现 setUTCHours(NaN) → Invalid Date → toISOString() 直接 throw，
 * 小程序编辑弹层里用户清空时刻提交就会拿到原始 RangeError。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, bjDateKey, combineHM, combineHmEndCrossDay, isoToBjInput, parseYmd, startOfWeek, weekName, zhDate, zhTime } from "../src/date.js";

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

/* ---- 十轮检视：宿主时区日期工具 NaN 守卫（垃圾/假日历入参不再产 "NaN-NaN-NaN"） ---- */

test("addDays/startOfWeek：垃圾与假日历入参原值返回（不再产 NaN-NaN-NaN）", () => {
  assert.equal(addDays("垃圾", 1), "垃圾");
  assert.equal(startOfWeek("垃圾"), "垃圾");
  // 2026-02-30 非 Invalid Date：JS 静默进位成 3 月 2 日，旧版 startOfWeek 会产出滚月后的错误日期
  assert.equal(addDays("2026-02-30", 1), "2026-02-30");
  assert.equal(startOfWeek("2026-02-30"), "2026-02-30");
  // 合法输入回归
  assert.equal(addDays("2026-10-08", 1), "2026-10-09");
  assert.equal(addDays("2026-10-08", -8), "2026-09-30");
  assert.equal(startOfWeek("2026-10-08"), "2026-10-05"); // 周三 → 本周一
});

test("parseYmd：假日历日/垃圾串返回 Invalid Date（不再静默进位成下月）", () => {
  assert.equal(Number.isNaN(parseYmd("2026-02-30").getTime()), true);
  assert.equal(Number.isNaN(parseYmd("2023-02-29").getTime()), true); // 平年无 2/29
  assert.equal(Number.isNaN(parseYmd("垃圾").getTime()), true);
  // 真实日历日回归（含闰年）
  assert.equal(parseYmd("2024-02-29").getTime(), new Date(2024, 1, 29).getTime());
  assert.equal(parseYmd("2026-10-08").getTime(), new Date(2026, 9, 8).getTime());
});

// —— 十五轮：zhDate/weekName 接住 Invalid Date（旧版产「NaN月NaN日」/undefined 直达界面） ——
test("zhDate/weekName：假日历日/垃圾串原样返回，不再产 NaN 文案", () => {
  assert.equal(zhDate("2026-02-30"), "2026-02-30");
  assert.equal(zhDate("垃圾"), "垃圾");
  assert.equal(weekName("2026-02-30"), "2026-02-30");
  assert.equal(weekName("垃圾"), "垃圾");
  assert.equal(zhDate("2026-10-08"), "10月8日"); // 回归
  assert.equal(weekName("2026-10-08"), "周四"); // 回归
});

test("r16：bjDateKey/zhTime 非法 ISO 防御（不抛 RangeError）", () => {
  assert.equal(bjDateKey("not-a-date"), "");
  assert.equal(bjDateKey(""), "");
  assert.equal(zhTime("bad-iso"), "—");
  // 回归：合法串原样
  assert.equal(bjDateKey("2026-10-22T07:00:00Z"), "2026-10-22"); // UTC 15 点 = 北京 22 日
  assert.equal(zhTime("2026-10-22T07:05:00Z"), "15:05");
});
