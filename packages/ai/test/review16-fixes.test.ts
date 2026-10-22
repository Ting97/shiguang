/**
 * 全量检视十六轮修复回归（2026-10-22 批次）：
 * E1 裸「N号」线址后缀（2号线/3号楼）不再被当日期消费；
 * E2 「小时半」紧邻判定（跨段不再污染首个时长）；
 * E3 带单位尾数不并量词数字（100元5张票 ≠ 100.5 元）；
 * E8 相对时长分钟支持小数（1.5小时后）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, parseAmountCents } from "../src/duration.js";
import { deterministicOccurredDate } from "../src/parse.js";
import { hasExplicitDayRef, relativeOffsetMinutes } from "../src/time-infer.js";

const NOW = new Date("2026-10-22T15:00:00+08:00"); // 北京 2026-10-22（周四）15:00

/* ---- E1：裸 N号 的线址/楼栋后缀是编号不是日期 ---- */

test("occurredDate：「坐2号线/3号楼/5号门」的 N号 不再被当日期（宁落默认今天）", () => {
  assert.equal(deterministicOccurredDate("坐2号线花了4块", NOW), null); // 旧版 → 2026-10-02（回跳 20 天）
  assert.equal(deterministicOccurredDate("坐13号线通勤花了6块", NOW), null);
  assert.equal(deterministicOccurredDate("在3号楼下超市买了水花了5块", NOW), null);
  assert.equal(deterministicOccurredDate("从2号门进的园区花了10块", NOW), null);
  // 回归：真日期话术不受 lookahead 误伤
  assert.equal(deterministicOccurredDate("15号交了房租", NOW), "2026-10-15");
  assert.equal(deterministicOccurredDate("3号买的球衣", NOW), "2026-10-03");
});

test("hasExplicitDayRef：「坐2号线花了4块」不含显式日期（锚定豁免不被误触发）", () => {
  assert.equal(hasExplicitDayRef("坐2号线花了4块"), false);
  assert.equal(hasExplicitDayRef("在3号楼下超市买了水"), false);
  assert.equal(hasExplicitDayRef("15号交了房租"), true); // 回归
});

/* ---- E2：「小时半」按当前匹配的紧邻后缀判定 ---- */

test("parseDuration：跨段句子的「小时半」只给自己那段 +30（旧版全文扫描污染首个时长）", () => {
  assert.equal(parseDuration("开会3小时然后骑一小时半"), 180); // 旧版 210
  assert.equal(parseDuration("运动1小时，晚上追剧一小时半"), 60); // 旧版 90
  assert.equal(parseDuration("开了一小时半的会"), 90); // 回归：单段照常补半
  assert.equal(parseDuration("跑了两小时半马"), 120); // 回归：半马不受影响
});

/* ---- E3：带单位口语尾数不并数量短语 ---- */

test("parseAmountCents：「100元5张票」=100 元（尾数后跟量词不并入）", () => {
  assert.equal(parseAmountCents("买了100元5张票"), 10_000); // 旧版 10050（100.5 元）
  assert.equal(parseAmountCents("付了30元3个包子"), 3_000); // 旧版 3030
  // 回归：真口语毛数照常并入
  assert.equal(parseAmountCents("花了35块5"), 3_550);
  assert.equal(parseAmountCents("一瓶水花了3块5"), 350);
});

/* ---- E8：相对时长分钟支持小数 ---- */

test("relativeOffsetMinutes：「1.5小时后开会」=90（旧版 lookbehind 整段拒绝）", () => {
  assert.equal(relativeOffsetMinutes("1.5小时后开会"), 90);
  assert.equal(relativeOffsetMinutes("0.5小时后出发"), 30);
  assert.equal(relativeOffsetMinutes("两小时后交报告"), 120); // 回归：中文数字
  assert.equal(relativeOffsetMinutes("一个半小时后出发"), 90); // 回归：个半
  assert.equal(relativeOffsetMinutes("开了一小时的会"), null); // 回归：非「后」形态
});
