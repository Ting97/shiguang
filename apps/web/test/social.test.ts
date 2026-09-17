import { test } from "node:test";
import assert from "node:assert/strict";
import {
  birthdayCountdown,
  birthdayLabel,
  inferGroupFromName,
  inferInteractionType,
} from "../src/lib/social.ts";

test("分组推断：称谓命中对应分组", () => {
  assert.equal(inferGroupFromName("同事小李"), "同事");
  assert.equal(inferGroupFromName("王老板"), "同事");
  assert.equal(inferGroupFromName("客户张总"), "客户");
  assert.equal(inferGroupFromName("大学同学阿凯"), "同学");
  assert.equal(inferGroupFromName("老妈"), "家人");
  assert.equal(inferGroupFromName("三姨"), "家人");
  assert.equal(inferGroupFromName("岳父"), "家人");
});

test("分组推断：普通名字返回 null（落默认「朋友」）", () => {
  assert.equal(inferGroupFromName("老王"), null);
  assert.equal(inferGroupFromName("老张"), null);
  assert.equal(inferGroupFromName(""), null);
});

test("往来类型推断：事件短语映射", () => {
  assert.equal(inferInteractionType("吃饭"), "见面");
  assert.equal(inferInteractionType("喝咖啡"), "见面");
  assert.equal(inferInteractionType("打电话"), "通话");
  assert.equal(inferInteractionType("送礼"), "送礼");
  assert.equal(inferInteractionType("收到红包"), "收礼");
  assert.equal(inferInteractionType("帮我搬家"), "帮忙");
  assert.equal(inferInteractionType("请我们吃饭"), "请客");
  assert.equal(inferInteractionType("开会"), "见面");
});

test("往来类型推断：空与未知归「其他」", () => {
  assert.equal(inferInteractionType(null), "其他");
  assert.equal(inferInteractionType(""), "其他");
  assert.equal(inferInteractionType("写了代码"), "其他");
});

test("生日倒计时：今年未到/已过/今天", () => {
  const today = new Date(2026, 8, 18); // 2026-09-18
  assert.equal(birthdayCountdown("1995-10-02", today), 14); // 今年还没过
  assert.equal(birthdayCountdown("1995-09-10", today), 357); // 今年已过 → 明年
  assert.equal(birthdayCountdown("1995-09-18", today), 0); // 今天
  assert.equal(birthdayCountdown("10-02", today), 14); // 无年份也可
  assert.equal(birthdayCountdown(null, today), null);
  assert.equal(birthdayCountdown("不是日期", today), null);
});

test("生日展示文案：今天/明天/N 天后", () => {
  const today = new Date(2026, 8, 18);
  assert.deepEqual(birthdayLabel("1995-10-02", today), { date: "10月2日", countdown: "14 天后生日" });
  assert.deepEqual(birthdayLabel("1995-09-18", today), { date: "9月18日", countdown: "🎂 今天生日" });
  assert.deepEqual(birthdayLabel("1995-09-19", today), { date: "9月19日", countdown: "明天生日" });
  assert.equal(birthdayLabel(null, today), null);
});
