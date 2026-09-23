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

// ---- confidence 容错（LLM 偶发输出非数字 → 低置信转 pending，而非整包拒绝）----
import { ScheduleDraftV2, TodoDraftV2, SpaceClassification } from "../src/schema.js";

test("confidence 容错：字符串数字可解析、垃圾值回落 0.5（转待确认）", () => {
  const ok = ScheduleDraftV2.parse({
    applicable: true, activity: "study", title: "背单词",
    start: "2026-09-23T08:00:00+08:00", end: "2026-09-23T08:40:00+08:00",
    confidence: "0.8",
  });
  assert.equal(ok.confidence, 0.8);

  const junk = TodoDraftV2.parse({ applicable: true, due: "2026-09-24T10:00:00+08:00", confidence: "medium" });
  assert.equal(junk.confidence, 0.5); // 低于 0.6 阈值 → pending 待确认，而非整体校验失败
});

test("confidence 容错：缺失同样回落 0.5；合法值不受影响", () => {
  const missing = SpaceClassification.parse({ spaceId: null });
  assert.equal(missing.confidence, 0.5);
  const good = SpaceClassification.parse({ spaceId: null, confidence: 0.95 });
  assert.equal(good.confidence, 0.95);
});

/* ---- 回归5：跨午夜区间早晨补记（07:30 说「10.30到6.30睡觉」曾记成今晚的未来块） ---- */
import { anchorRangeToToday } from "../src/time-infer.js";
import { FinanceDraftV2 } from "../src/schema.js";

test("跨午夜早晨补记：规则路径归昨晚（起点在未来才回移，晚间说保留今晚）", () => {
  // 北京 2026-09-20 07:30（= 09-19T23:30Z）
  const morning = new Date("2026-09-19T23:30:00Z");
  const tb = inferTimeBlock("晚上10.30到6.30睡觉", morning, 480, "evening");
  assert.equal(tb.start.getTime(), CST("2026-09-19T22:30:00+08:00"), "起点=昨晚22:30");
  assert.equal(tb.end.getTime(), CST("2026-09-20T06:30:00+08:00"), "终点=今晨06:30");
  assert.equal(tb.durationMin, 480);

  // 晚间 21:00 说同样的话：起点已在今晚 → 保留今晚（不当昨晚处理）
  const evening = new Date("2026-09-20T13:00:00Z"); // 北京 21:00
  const tb2 = inferTimeBlock("晚上10.30到6.30睡觉", evening, 480, "evening");
  assert.equal(tb2.start.getTime(), CST("2026-09-20T22:30:00+08:00"));
  assert.equal(tb2.end.getTime(), CST("2026-09-21T06:30:00+08:00"));
});

test("AI 锚定：跨午夜区间终点落今天（早晨补记昨晚睡眠）→ 保留不前移", () => {
  const now = new Date("2026-09-19T23:30:00Z"); // 北京 09-20 07:30
  const range = {
    start: new Date(CST("2026-09-19T22:30:00+08:00")), // 模型给了昨晚 22:30
    end: new Date(CST("2026-09-20T06:30:00+08:00")),   // 今晨 06:30
  };
  const r = anchorRangeToToday(range, "睡觉", now);
  assert.equal(r.start.getTime(), range.start.getTime(), "已整体过去的昨晚区间不动");
  assert.equal(r.end.getTime(), range.end.getTime());
});

test("AI 锚定：终点也在昨天的漂移区间（白天说下午2-6点）→ 仍归今天（原事故语义不变）", () => {
  const now = new Date("2026-09-20T09:22:00Z"); // 北京 09-20 17:22
  const r = anchorRangeToToday(
    { start: new Date(CST("2026-09-19T14:00:00+08:00")), end: new Date(CST("2026-09-19T18:00:00+08:00")) },
    "下午2点到6点在写代码",
    now,
  );
  assert.equal(r.start.getTime(), CST("2026-09-20T14:00:00+08:00"));
  assert.equal(r.end.getTime(), CST("2026-09-20T18:00:00+08:00"));
});

/* ---- 回归6：V2 域布尔契约（z.coerce.boolean 曾把 "false" 强转 true → 幻影日程/流水） ---- */

test("llmBoolean：字符串 \"false\" 是 false，\"true\"/true 是 true，缺答仍校验失败", () => {
  const off = ScheduleDraftV2.safeParse({
    applicable: "false", activity: "other", title: "有点累",
    start: null, end: null, confidence: 0.9,
  });
  assert.equal(off.success, true);
  assert.equal(off.success ? off.data.applicable : null, false, "\"false\" 不得强转 true");

  const on = ScheduleDraftV2.parse({
    applicable: "true", activity: "study", title: "背单词",
    start: "2026-09-24T08:00", end: "2026-09-24T08:40", confidence: 0.9,
  });
  assert.equal(on.applicable, true);

  const missing = ScheduleDraftV2.safeParse({
    activity: "study", title: "背单词",
    start: "2026-09-24T08:00", end: "2026-09-24T08:40", confidence: 0.9,
  });
  assert.equal(missing.success, false, "V2 漏答即不合格语义保留（触发修复重问）");

  const fin = FinanceDraftV2.parse({ hasAmount: "false", direction: "out", amountCents: null, confidence: 0.9 });
  assert.equal(fin.hasAmount, false);
});

test("V2 上限：超大金额/时长不再放行（防 PG int4 溢出 500）", () => {
  const huge = FinanceDraftV2.safeParse({ hasAmount: true, direction: "out", amountCents: 999_999_999_999, confidence: 0.9 });
  assert.equal(huge.success, false);
  const long = ScheduleDraftV2.safeParse({
    applicable: true, activity: "sleep", title: "睡觉",
    start: "2026-09-24T08:00", end: "2026-09-24T09:00",
    durationMin: 999_999, confidence: 0.9,
  });
  assert.equal(long.success, false);
});

/* ---- 回归7：金额万/千量词 + 钟点上下文的"Y分"不再误判为时长 ---- */

test("parseAmountCents：'花了1万'=100万分，'花了2千'=20万分，裸数字不变", () => {
  assert.equal(parseAmountCents("今天花了1万买手机"), 1_000_000);
  assert.equal(parseAmountCents("花了2千请客"), 200_000);
  assert.equal(parseAmountCents("花了260"), 26_000);
});

test("parseDuration：'下午3点50分开了个会' 不再把 50 当时长", () => {
  assert.equal(parseDuration("下午3点50分开了个会"), null);
  assert.equal(parseDuration("开了50分钟的会"), 50); // 真时长不受影响
});

/* ---- 回归8：批量语义修复（大后天/晚上12点/title 截断/随礼误判/2-29 生日） ---- */

import { mock } from "node:test";
import { detectFuture } from "../src/time-infer.js";
import { parseInput, parseHybridInput } from "../src/parse.js";
import { birthdayCountdown } from "@shiguangri/shared/social";

test("大后天：+3 天（不再被 /后天/ 先命中成 +2）", () => {
  assert.equal(detectFuture("大后天交季度报告"), "twoDaysAfter");
  assert.equal(detectFuture("后天回老家"), "dayAfter"); // 既有语义不变
  const tb = inferTimeBlock("大后天上午十点开会", NOW, 60);
  assert.equal(tb.mode, "future");
  // 9-17（周四）说"大后天" → 9-20 上午十点
  assert.equal(tb.start.getTime(), CST("2026-09-20T10:00:00+08:00"));
});

test("晚上12点：午夜非正午 → 次日 0 点（'明天晚上12点'落 9-19 00:00，不再落当天正午）", () => {
  const tb = inferTimeBlock("明天晚上12点才睡", NOW, 30);
  assert.equal(tb.mode, "future");
  assert.equal(tb.start.getTime(), CST("2026-09-19T00:00:00+08:00"));
  // 中午12点不受影响（仍是正午）
  assert.equal(inferTimeBlock("明天中午12点吃饭", NOW, 30).start.getTime(), CST("2026-09-18T12:00:00+08:00"));
});

test("混合引擎：GLM 抽出 31~40 字标题 → 截断到 30（曾越界 zod 抛错且无法降级）", async () => {
  // 环境门（与 hybrid.test.ts 同款）：fetch 全程 mock 不会真连
  process.env.ZHIPUAI_API_KEY ??= "test-key";
  process.env.TYPESAFE_API_KEY ??= "test-key";
  process.env.JEV_MODE = "on";
  const impl = async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/v1/systemone")) {
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            sched_applicable: { noul: 0.95 },
            todo_applicable: { noul: 0.05 },
            record_type: { choice: "past", probabilities: { past: 0.97, future: 0.03 } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("chat/completions")) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: "很".repeat(40), people: [], dietItems: [] }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`mock: 未预期的请求 ${u}`);
  };
  mock.method(globalThis, "fetch", impl);
  try {
    const r = await parseHybridInput("下午开了一个很长的会", { now: NOW });
    assert.equal(r.engine, "jev-hybrid");
    assert.equal(r.title.length, 30, "瘦身契约允许 40 字，入库契约 30 字 → 此处必须截断");
  } finally {
    mock.restoreAll();
  }
});

test("规则兜底：「随便逛逛花了230」不再误判人情往来（裸'随'不再命中，仅随礼/份子/礼金/红包）", async () => {
  const r = await parseInput("随便逛逛花了230", { now: NOW, forceRules: true });
  assert.equal(r.finance.hasAmount, true);
  assert.equal(r.finance.amountCents, 23000);
  assert.notEqual(r.finance.category, "人情往来");
});

test("2/29 生日：平年倒计时显式取 2/28（不再滚到 3/1），闰年仍 2/29", () => {
  assert.equal(birthdayCountdown("1996-02-29", new Date(2026, 1, 27)), 1); // 平年 2/27 → 明天 2/28
  assert.equal(birthdayCountdown("1996-02-29", new Date(2026, 1, 28)), 0); // 平年 2/28 当天即生日
  assert.equal(birthdayCountdown("1996-02-29", new Date(2026, 2, 1)), 364); // 已过 → 明年 2/28
  assert.equal(birthdayCountdown("1996-02-29", new Date(2024, 1, 28)), 1); // 闰年仍是 2/29（回归）
});
