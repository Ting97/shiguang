/**
 * 批量修复回归（时区/小数时长/金额误判/JSON 尾随文字）。
 * 时区断言全部使用绝对毫秒值或 +08:00 锚定的参照 Date：引擎已不依赖宿主时区，
 * 因此在任何 TZ（含 UTC 宿主）下这些断言都必须逐毫秒成立——旧实现仅在 CST 宿主碰巧正确。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, parseAmountCents } from "../src/duration.js";
import { extractJson } from "../src/glm.js";
import { inferTimeBlock, resolveMoment, resolveExplicitRange, detectDayRef } from "../src/time-infer.js";

const CST = (s: string) => new Date(s).getTime(); // 参照：带偏移的 ISO 串的绝对时刻

/* ---------- 修复2：小数时长（"运动1.5小时"曾滑到"5小时"=300） ---------- */

test("小数时长：1.5小时=90（不再截成 5 小时=300）", () => {
  assert.equal(parseDuration("运动1.5小时"), 90);
  assert.equal(parseDuration("刷剧2.5小时"), 150);
  assert.equal(parseDuration("散步0.5小时"), 30);
});

test("小数时长：整数与中文数字不受影响（回归）", () => {
  assert.equal(parseDuration("健身5小时"), 300);
  assert.equal(parseDuration("练了40分钟"), 40);
  assert.equal(parseDuration("两个小时"), 120);
  assert.equal(parseDuration("一个半小时"), 90);
  assert.equal(parseDuration("半小时"), 30);
});

/* ---------- 修复3：金额负向断言补「小/周」 ---------- */

test("金额误判：'花了3小时/2周'不是钱", () => {
  assert.equal(parseAmountCents("打扫卫生花了3小时"), null);
  assert.equal(parseAmountCents("花了2周看完一本书"), null);
  assert.equal(parseAmountCents("花了1.5小时健身"), null);
  assert.equal(parseAmountCents("花了50分钟"), null); // 既有负向保留
});

test("金额正例不受影响（回归）", () => {
  assert.equal(parseAmountCents("花了260"), 26000);
  assert.equal(parseAmountCents("付了86"), 8600);
  assert.equal(parseAmountCents("充值100"), 10000);
  assert.equal(parseAmountCents("随了600块礼"), 60000);
  assert.equal(parseAmountCents("980.5元"), 98050);
});

/* ---------- 修复4：extractJson 容忍尾随文字 ---------- */

test("extractJson：JSON 后跟废话仍可解析（旧实现直接抛错）", () => {
  assert.deepEqual(extractJson('{"a":1}\n以上是结果'), { a: 1 });
  assert.deepEqual(extractJson('[1,2,3] 这是数组'), [1, 2, 3]);
  assert.deepEqual(
    extractJson('前缀 {"schedule":{"applicable":true},"todo":null} 以上就是识别结果，谢谢'),
    { schedule: { applicable: true }, todo: null },
  );
});

test("extractJson：字符串字面量内的括号/引号不参与配平", () => {
  assert.deepEqual(extractJson('{"s":"他说\\"}好"}\n完毕'), { s: '他说"}好' });
  assert.deepEqual(extractJson('{"a":"含[中]括{号}"} 尾巴'), { a: "含[中]括{号}" });
});

test("extractJson：围栏/截断语义不变（回归）", () => {
  assert.deepEqual(extractJson('```json\n{"ok":true}\n```\n以上是结果'), { ok: true });
  assert.deepEqual(extractJson('{"ok":1}'), { ok: 1 });
  assert.throws(() => extractJson('{"a": 1'), "未配平仍由 JSON.parse 报错");
  assert.throws(() => extractJson("完全没有大括号"), /无 JSON/);
});

/* ---------- 修复1：time-infer 宿主时区（断言绝对毫秒，UTC 宿主上也必须成立） ---------- */

const NOW = new Date("2026-09-17T15:00:00+08:00"); // 周四 15:00（北京）

test("resolveMoment：无时区北京本地串 = +08:00 语义（UTC 宿主不再偏 8 小时）", () => {
  assert.equal(resolveMoment("2026-09-20T14:30", NOW)?.getTime(), CST("2026-09-20T14:30:00+08:00"));
  assert.equal(resolveMoment("2026-09-20T14:30:05", NOW)?.getTime(), CST("2026-09-20T14:30:05+08:00"));
  assert.equal(resolveMoment("2026-09-20 14:30", NOW)?.getTime(), CST("2026-09-20T14:30:00+08:00"));
});

test("resolveMoment：带时区/纯日期串维持原语义（回归）", () => {
  assert.equal(resolveMoment("2026-09-20T14:30:00Z", NOW)?.getTime(), Date.UTC(2026, 8, 20, 14, 30));
  assert.equal(resolveMoment("2026-09-20T14:30:00-05:00", NOW)?.getTime(), CST("2026-09-20T14:30:00-05:00"));
  assert.equal(resolveMoment("2026-09-20", NOW)?.getTime(), Date.parse("2026-09-20"));
  assert.equal(resolveMoment("not-a-date", NOW), null);
  assert.equal(resolveMoment("2020-01-01T00:00", NOW), null); // 超 366 天
});

test("resolveExplicitRange：起止都按北京本地串解析", () => {
  const r = resolveExplicitRange("2026-09-20T14:00", "2026-09-20T18:00", NOW);
  assert.ok(r);
  assert.equal(r.start.getTime(), CST("2026-09-20T14:00:00+08:00"));
  assert.equal(r.end.getTime(), CST("2026-09-20T18:00:00+08:00"));
});

test("atHour：时段锚点按北京钟面（UTC 宿主不再错 8 小时）", () => {
  const tb = inferTimeBlock("晚上刷了会儿抖音", NOW, 30);
  assert.equal(tb.mode, "relative");
  // 15:00 说"晚上"且当下不在晚间窗口 → 锚点归昨晚 19:00（既有行为，但钟面必须按北京时区）
  assert.equal(tb.start.getTime(), CST("2026-09-16T19:00:00+08:00"));
  assert.equal(tb.end.getTime(), CST("2026-09-16T19:30:00+08:00"));
});

test("显式钟点区间：起止按北京钟面落位", () => {
  const tb = inferTimeBlock("下午2点到6点在写代码", new Date("2026-09-20T17:22:00+08:00"), 60);
  assert.equal(tb.mode, "explicit");
  assert.equal(tb.start.getTime(), CST("2026-09-20T14:00:00+08:00"));
  assert.equal(tb.end.getTime(), CST("2026-09-20T18:00:00+08:00"));
  assert.equal(tb.durationMin, 240);
});

test("未来话术：明天钟点按北京时区", () => {
  const tb = inferTimeBlock("明天下午三点去看牙医", NOW, 60);
  assert.equal(tb.mode, "future");
  assert.equal(tb.start.getTime(), CST("2026-09-18T15:00:00+08:00"));
});

test("下周X：星期定位按北京日历（now 取 UTC 深夜，CST 已是次日）", () => {
  // 2026-09-23T16:00Z = 北京 9-24（周四）00:00；下周三 = 北京 9-30 09:00（默认锚点）
  const tb = inferTimeBlock("下周三开会", new Date("2026-09-23T16:00:00Z"), 60);
  assert.equal(tb.mode, "future");
  assert.equal(tb.start.getTime(), CST("2026-09-30T09:00:00+08:00"));
});

test("detectDayRef：周X按北京星期（UTC 周三深夜 = 北京周四）", () => {
  const now = new Date("2026-09-23T16:00:00Z"); // 北京 9-24 周四
  assert.equal(detectDayRef("周一", now), -3); // 北京 9-21
  assert.equal(detectDayRef("上周三", now), -8); // 北京 9-16
  assert.equal(detectDayRef("昨天", now), -1);
});
