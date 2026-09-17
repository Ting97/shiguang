import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTimeBlock, detectPeriod } from "../src/time-infer.js";

const NOW = new Date("2026-09-17T15:00:00+08:00"); // 周四下午三点

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
