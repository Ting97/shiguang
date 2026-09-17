import { test } from "node:test";
import assert from "node:assert/strict";
import {
  birthdayCountdown,
  birthdayLabel,
  inferGroupFromContext,
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

test("上下文分组推断：LLM 剥掉的身份前缀从原句找回来", () => {
  // 「客户张总」被 LLM 抽成「张总」→ 回原句拼回前缀
  assert.equal(inferGroupFromContext("张总", "下午和客户张总开会聊了1小时"), "客户");
  assert.equal(inferGroupFromContext("小李", "上午和同事小李对齐了需求"), "同事");
  assert.equal(inferGroupFromContext("阿凯", "晚上和大学同学阿凯打球"), "同学");
  // 名字本身可命中的直接短路，不依赖原句
  assert.equal(inferGroupFromContext("老妈", "老妈打电话来了"), "家人");
  // 原句没有身份线索 → null（落「朋友」）
  assert.equal(inferGroupFromContext("老王", "中午和老王吃饭花了260"), null);
  // 原句里找不到名字 → null
  assert.equal(inferGroupFromContext("张总", "陪爸妈逛街"), null);
  assert.equal(inferGroupFromContext("", "任意"), null);
  assert.equal(inferGroupFromContext("张总", ""), null);
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
