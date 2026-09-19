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
  assert.deepEqual(birthdayLabel({ birthday: "1995-10-02" }, today), { date: "10月2日", countdown: "14 天后生日" });
  assert.deepEqual(birthdayLabel({ birthday: "1995-09-18" }, today), { date: "9月18日", countdown: "🎂 今天生日" });
  assert.deepEqual(birthdayLabel({ birthday: "1995-09-19" }, today), { date: "9月19日", countdown: "明天生日" });
  assert.equal(birthdayLabel({ birthday: null }, today), null);
});

test("农历生日：换算/倒计时/闰月回落", async () => {
  const { lunarBirthdayLabel, lunarBirthdayCountdown, nextLunarBirthdaySolar } = await import("../src/lib/lunar.ts");
  // 2025 农历六月初三 = 公历 2025-06-27（实测 solarlunar）
  const today1 = new Date(2025, 5, 20); // 2025-06-20
  const b = { month: 6, day: 3, leap: false };
  assert.equal(lunarBirthdayLabel(b), "六月初三");
  assert.equal(nextLunarBirthdaySolar(b, today1)?.toDateString(), new Date(2025, 5, 27).toDateString());
  assert.equal(lunarBirthdayCountdown(b, today1), 7);
  // 已过 → 明年（2026 农历六月初三 = 2026-07-16）
  const today2 = new Date(2025, 6, 1); // 2025-07-01
  assert.equal(nextLunarBirthdaySolar(b, today2)?.toDateString(), new Date(2026, 6, 16).toDateString());
  // 闰六月生日：2025 有闰六月（闰六月初三 = 2025-07-27）；2026 无闰六月 → 回落平月
  const leapB = { month: 6, day: 3, leap: true };
  assert.equal(lunarBirthdayLabel(leapB), "闰六月初三");
  const today3 = new Date(2025, 6, 1); // 2025-07-01（平月初三已过）
  assert.equal(nextLunarBirthdaySolar(leapB, today3)?.toDateString(), new Date(2025, 6, 27).toDateString()); // 闰六月
  const today4 = new Date(2025, 7, 1); // 2025-08-01（今年闰六月也已过）
  assert.equal(nextLunarBirthdaySolar(leapB, today4)?.toDateString(), new Date(2026, 6, 16).toDateString()); // 2026 无闰 → 平月六月初三（2026-07-16）
  // 三十生日在小月按当月最后一天过：2025 腊月是小月（三十不存在）→ 廿九 = 2026-02-16（除夕）
  const b30 = { month: 12, day: 30, leap: false };
  const today5 = new Date(2025, 11, 1); // 2025-12-01
  assert.equal(nextLunarBirthdaySolar(b30, today5)?.toDateString(), new Date(2026, 1, 16).toDateString());
  // 统一入口（阳历/农历自动区分）：date 带「农历」前缀，countdown 走农历换算
  const uni = birthdayLabel({ birthday_cal: "lunar", lunar_month: 6, lunar_day: 3 }, today1);
  assert.deepEqual(uni, { date: "农历六月初三", countdown: "7 天后生日" });
});
