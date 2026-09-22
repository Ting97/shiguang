import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput } from "../src/parse.js";
import { ruleMood } from "../src/mood-rules.js";
import { CONFIDENCE_THRESHOLD } from "../src/schema.js";

const NOW = new Date(2026, 8, 17, 15, 0); // 2026-09-17（周四）15:00 本地时间
const parse = (text: string) => parseInput(text, { now: NOW, forceRules: true });

// ---------- 意图派生：schedule / todo / status ----------

test("过去话术 → schedule（落日程）", async () => {
  const r = await parse("刚跑完步，练了40分钟");
  assert.equal(r.intent, "schedule");
  assert.equal(r.scheduleApplicable, true);
  assert.equal(r.time.durationMin, 40);
});

test("未来话术 → todo（落待办）", async () => {
  const r = await parse("明天下午三点去看牙医");
  assert.equal(r.intent, "todo");
  assert.equal(r.time.mode, "future");
  assert.equal(r.scheduleApplicable, false); // 未来计划不生成日程块
});

test("纯心情话术 → status（仅动态，不落日程）", async () => {
  const r = await parse("今天有点累");
  assert.equal(r.intent, "status");
  assert.equal(r.scheduleApplicable, false, "无事件信号不应强制建日程");
  assert.equal(r.mood.label, "疲惫");
  assert.ok((r.mood.score ?? 0) < 0);
});

test("心情+具体事 → schedule 且带心情", async () => {
  const r = await parse("累死了终于把报告写完了");
  assert.equal(r.intent, "schedule");
  assert.equal(r.activity, "work");
  assert.equal(r.mood.label, "疲惫");
});

test("未来话术带情绪 → todo 且带心情（future 优先）", async () => {
  const r = await parse("明天要交报告了好焦虑");
  assert.equal(r.intent, "todo");
  assert.equal(r.mood.label, "焦虑");
  assert.ok((r.mood.score ?? 0) < 0);
});

// ---------- 已发生 / 进行中 / 未来：结合当前时间判定 ----------

test("已过时段补记 → schedule（线上回归：'工作准备'曾被'准备'误判成待办）", async () => {
  // 15:00 补记早上的时段；话术无活动词也无时长词，但显式起止区间本身是"具体的事"
  const r = await parse("今天9:10到9:30工作准备+喝水");
  assert.notEqual(r.intent, "todo");
  assert.equal(r.ongoing, false);
  const s = new Date(r.time.start);
  const e = new Date(r.time.end);
  assert.equal(`${s.getHours()}:${s.getMinutes()}`, "9:10");
  assert.equal(`${e.getHours()}:${e.getMinutes()}`, "9:30");
});

test("带活动词的已过区间 → schedule 且时间精确", async () => {
  const r = await parse("今天9:10到9:30跑了步");
  assert.equal(r.intent, "schedule");
  assert.equal(r.ongoing, false);
  const s = new Date(r.time.start);
  assert.equal(`${s.getHours()}:${s.getMinutes()}`, "9:10");
});

test("进行中（已开始未结束）→ schedule + ongoing（上层补收尾待办）", async () => {
  const r = await parse("今天14:30到15:30开会");
  assert.equal(r.intent, "schedule");
  assert.equal(r.ongoing, true);
  const s = new Date(r.time.start);
  const e = new Date(r.time.end);
  assert.equal(`${s.getHours()}:${s.getMinutes()}`, "14:30");
  assert.equal(`${e.getHours()}:${e.getMinutes()}`, "15:30");
});

test("进行中的话术无活动词 → 显式区间兜底为 schedule", async () => {
  const r = await parse("今天14:30到15:30工作准备+喝水");
  assert.equal(r.intent, "schedule");
  assert.equal(r.ongoing, true);
});

test("未开始的未来话术 → todo 且 ongoing=false", async () => {
  const r = await parse("准备去开会");
  assert.equal(r.intent, "todo");
  assert.equal(r.ongoing, false);
});

test("做事不带情绪 → mood 为空", async () => {
  const r = await parse("晚上刷了会儿抖音");
  assert.equal(r.intent, "schedule");
  assert.equal(r.mood.label, null);
  assert.equal(r.mood.score, null);
});

test("纯感想（无活动词）→ 不强制建日程", async () => {
  const r = await parse("这个月过得好快啊");
  assert.equal(r.intent, "status");
  assert.equal(r.scheduleApplicable, false);
});

// ---------- 饮食域 ----------

test("饮食命中：吃饭话术 → diet 适用 + items 非空", async () => {
  const r = await parse("中午吃了一碗牛肉面");
  assert.equal(r.diet.applicable, true);
  assert.equal(r.diet.meal, "午餐");
  assert.ok(r.diet.items.length > 0);
  assert.equal(r.intent, "schedule", "吃饭同时是日程");
});

test("饮食排除：白水不计", async () => {
  const r = await parse("刚才喝了口水");
  assert.equal(r.diet.applicable, false);
});

test("奶茶/咖啡命中饮食域", async () => {
  const r = await parse("下午喝了杯奶茶");
  assert.equal(r.diet.applicable, true);
  assert.equal(r.diet.meal, "未知");
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

// ---------- 复合句：五域独立命中 ----------

test("复合句：日程+金额+人物+心情同时命中", async () => {
  // FR-D2.3：演示人名移除——人物识别改由联系人名单驱动（contactNames）
  const r = await parseInput("中午和老王吃饭花了260，吃得挺开心", {
    now: NOW, forceRules: true, contactNames: ["老王"],
  });
  assert.equal(r.intent, "schedule");
  assert.equal(r.activity, "social");
  assert.equal(r.finance.amountCents, 26000); // 金额恒为正，方向在 direction
  assert.equal(r.finance.direction, "out");
  assert.deepEqual(r.people.map((p) => p.name), ["老王"], "名单命中 → 产出人物");
  assert.equal(r.mood.label, "开心");
  assert.ok((r.mood.score ?? 0) > 0);
  assert.equal(r.diet.applicable, true, "吃饭话术饮食域应命中");

  // 空名单：规则引擎不产人物（同名话术）
  const r2 = await parse("中午和老王吃饭花了260，吃得挺开心");
  assert.deepEqual(r2.people.map((p) => p.name), [], "空名单不产人物");
});

// ---------- 置信度结构 ----------

test("五域置信度结构齐备且在 [0,1]", async () => {
  const r = await parse("刚跑完步");
  for (const c of [r.scheduleConfidence, r.todoConfidence, r.financeConfidence, r.mood.confidence, r.diet.confidence]) {
    assert.ok(c >= 0 && c <= 1, `置信度越界: ${c}`);
  }
  assert.ok(CONFIDENCE_THRESHOLD > 0 && CONFIDENCE_THRESHOLD < 1);
});
