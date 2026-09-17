import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput } from "../src/parse.js";
import { ruleMood } from "../src/parse.js";

const NOW = new Date(2026, 8, 17, 15, 0); // 2026-09-17（周四）15:00 本地时间
const parse = (text: string) => parseInput(text, { now: NOW, forceRules: true });

// ---------- 意图三分：schedule / todo / status ----------

test("过去话术 → schedule（落日程）", async () => {
  const r = await parse("刚跑完步，练了40分钟");
  assert.equal(r.intent, "schedule");
  assert.equal(r.time.durationMin, 40);
});

test("未来话术 → todo（落待办）", async () => {
  const r = await parse("明天下午三点去看牙医");
  assert.equal(r.intent, "todo");
  assert.equal(r.time.mode, "future");
});

test("纯心情话术 → status（仅动态，不落日程）", async () => {
  const r = await parse("今天有点累");
  assert.equal(r.intent, "status");
  assert.equal(r.mood.label, "疲惫");
  assert.ok((r.mood.score ?? 0) < 0);
});

test("心情+具体事 → schedule 且带心情", async () => {
  const r = await parse("累死了终于把报告写完了");
  assert.equal(r.intent, "schedule");
  assert.equal(r.activity, "work");
  assert.equal(r.mood.label, "疲惫");
});

test("未来话术带情绪 → todo 且带心情（future 优先于 status）", async () => {
  const r = await parse("明天要交报告了好焦虑");
  assert.equal(r.intent, "todo");
  assert.equal(r.mood.label, "焦虑");
  assert.ok((r.mood.score ?? 0) < 0);
});

test("做事不带情绪 → mood 为空", async () => {
  const r = await parse("晚上刷了会儿抖音");
  assert.equal(r.intent, "schedule");
  assert.equal(r.mood.label, null);
  assert.equal(r.mood.score, null);
});

// ---------- 心情规则表 ----------

test("心情词识别（正/负向）", () => {
  assert.deepEqual(ruleMood("心情不错，今天状态很好"), { label: "开心", score: 60 });
  assert.equal(ruleMood("好烦啊")?.label, "烦躁");
  assert.equal(ruleMood("emo了")?.label, "难过");
  assert.equal(ruleMood("惬意的一天")?.label, "放松");
  assert.equal(ruleMood("平静如水")?.label, "平静");
  assert.equal(ruleMood("开了个会"), null);
});

test("复合句：日程+金额+人物+心情同时命中", async () => {
  const r = await parse("中午和老王吃饭花了260，吃得挺开心");
  assert.equal(r.intent, "schedule");
  assert.equal(r.activity, "social");
  assert.equal(r.finance.amountCents, -26000);
  assert.deepEqual(r.people.map((p) => p.name), ["老王"]);
  assert.equal(r.mood.label, "开心");
  assert.ok((r.mood.score ?? 0) > 0);
});
