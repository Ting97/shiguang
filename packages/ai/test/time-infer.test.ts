import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTimeBlock, detectPeriod, detectFuture } from "../src/time-infer.js";

const NOW = new Date(2026, 8, 17, 15, 0); // 2026-09-17（周四）15:00 本地时间

test("刚 + 显式时长 → 回溯于当下", () => {
  const tb = inferTimeBlock("刚跑完步，练了40分钟", NOW, 60);
  assert.equal(tb.mode, "explicit");
  assert.equal(tb.durationMin, 40);
  assert.equal(tb.end.getTime(), NOW.getTime());
  assert.equal(tb.start.getTime(), NOW.getTime() - 40 * 60_000);
});

test("时段锚点 + 显式时长", () => {
  // 15:00 说"下午聊了两小时"：14:00 锚点会延伸到 16:00（未来）→ 钳制为 13:00~15:00
  const tb = inferTimeBlock("下午跟客户聊了两个小时", NOW, 60);
  assert.equal(tb.mode, "explicit");
  assert.equal(tb.durationMin, 120);
  assert.equal(new Date(tb.end).getTime(), NOW.getTime());
  assert.equal(new Date(tb.start).getHours(), 13);

  // 18:00 再说同一句：14:00~16:00 完全在过去 → 直接用锚点
  const eve = new Date(2026, 8, 17, 18, 0);
  const tb2 = inferTimeBlock("下午跟客户聊了两个小时", eve, 60);
  assert.equal(new Date(tb2.start).getHours(), 14);
  assert.equal(new Date(tb2.end).getHours(), 16);
});

test("时段锚点 + 默认时长（无显式时长）", () => {
  const tb = inferTimeBlock("晚上刷了会儿抖音", NOW, 30);
  assert.equal(tb.mode, "relative");
  assert.equal(new Date(tb.start).getHours(), 19); // 晚上锚点 19:00
});

test("无时段无时长 → 类别默认，结束于当下", () => {
  const tb = inferTimeBlock("跑步了", NOW, 60);
  assert.equal(tb.mode, "default");
  assert.equal(tb.durationMin, 60);
  assert.equal(tb.end.getTime(), NOW.getTime());
});

test("锚点不可晚于当前时刻（说'晚上'但现在是15点 → 视为昨天）", () => {
  const tb = inferTimeBlock("晚上加班了", NOW, 120);
  assert.ok(tb.end.getTime() <= NOW.getTime());
});

test("时段词识别", () => {
  assert.equal(detectPeriod("中午吃饭"), "noon");
  assert.equal(detectPeriod("下午开会"), "afternoon");
  assert.equal(detectPeriod("凌晨才睡"), "lateNight");
  assert.equal(detectPeriod("早上通勤"), "morning");
  assert.equal(detectPeriod("跑步了"), null);
});

// ---------- 未来话术 → TODO（mode='future'，不钳制） ----------

test("未来检测（含'一会儿'语境回归）", () => {
  assert.equal(detectFuture("刚做了一会儿拉伸"), null); // 过去语境
  assert.equal(detectFuture("过一会儿再去倒垃圾"), "soon"); // 未来语境
  assert.equal(detectFuture("明天下午三点去看牙医"), "tomorrow");
  assert.equal(detectFuture("待会儿记得倒垃圾"), "soon");
  assert.equal(detectFuture("下周三上午开产品评审会"), "nextWeek");
  assert.equal(detectFuture("后天回老家"), "dayAfter");
  assert.equal(detectFuture("下午跟客户聊了两个小时"), null);
  assert.equal(detectFuture("刚跑完步"), null);
});

test("明天+钟点 → 未来计划（明天15:00，不受当前钳制）", () => {
  const tb = inferTimeBlock("明天下午三点去看牙医", NOW, 60);
  assert.equal(tb.mode, "future");
  assert.equal(new Date(tb.start).getDate(), 18);          // 9月18日
  assert.equal(new Date(tb.start).getHours(), 15);         // 下午三点 = 15 点
});

test("待会儿 → now+1h", () => {
  const tb = inferTimeBlock("待会儿记得倒垃圾", NOW, 30);
  assert.equal(tb.mode, "future");
  assert.equal(new Date(tb.start).getHours(), 16);         // 15:00 + 1h
});

test("下周三 → 定位到下周星期三（9/23）", () => {
  const tb = inferTimeBlock("下周三上午开产品评审会", NOW, 60);
  assert.equal(tb.mode, "future");
  const s = new Date(tb.start);
  assert.equal(s.getDate(), 23);                            // 2026-09-23 是周三
  assert.equal(s.getHours(), 8);                            // 上午锚点
});

test("LLM 强制未来但无日期词 → 按 soon 处理", () => {
  const tb = inferTimeBlock("要交季度报告", NOW, 60, null, true);
  assert.equal(tb.mode, "future");
  assert.ok(tb.start.getTime() > NOW.getTime());
});
