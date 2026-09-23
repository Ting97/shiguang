import { test } from "node:test";
import assert from "node:assert/strict";
import { FullExtractionV2, domainExtractionV2 } from "../src/schema.js";
import { classifyGlmFailure } from "../src/glm.js";
import { parseInput } from "../src/parse.js";

const NOW = new Date(2026, 8, 20, 15, 0); // 2026-09-20 15:00 本地

/** 全量金标准：五域齐答、命中域字段齐全 */
const GOLD_FULL: /* 测试夹具需可写 null 以构造非法样本（zod 输入面比输出面宽） */ Record<string, any> = {
  reasoning: { schedule: "复合句", todo: "无", finance: "有金额", mood: "有情绪", diet: "无" },
  schedule: {
    applicable: true, activity: "social", title: "和小李吃饭",
    start: "2026-09-20T12:00", end: "2026-09-20T13:00", durationMin: 60,
    periodHint: "noon", confidence: 0.85,
  },
  todo: { applicable: false, due: null, confidence: 0.9 },
  finance: { hasAmount: true, direction: "out", amountCents: 26000, category: "餐饮", counterparty: "小李", confidence: 0.95 },
  mood: { label: "开心", score: 60, confidence: 0.9 },
  diet: { applicable: false, meal: "未知", items: [], totalKcal: null, confidence: 0.9 },
  people: [{ name: "小李", event: "吃饭" }],
  ambiguity: null,
};

test("schema v2：金标准全量输出通过校验", () => {
  const r = FullExtractionV2.safeParse(GOLD_FULL);
  assert.ok(r.success, JSON.stringify(r.error?.issues.slice(0, 3)));
});

test("schema v2：schedule applicable 但缺 start/end → 拒绝（触发修复重问）", () => {
  const bad = structuredClone(GOLD_FULL);
  bad.schedule.start = null;
  bad.schedule.end = null;
  const r = FullExtractionV2.safeParse(bad);
  assert.ok(!r.success);
  assert.ok(r.error.issues.some((i) => i.message.includes("start/end 必填")));
});

test("schema v2：end 早于 start → 拒绝", () => {
  const bad = structuredClone(GOLD_FULL);
  bad.schedule.end = "2026-09-20T11:00";
  const r = FullExtractionV2.safeParse(bad);
  assert.ok(!r.success);
});

test("schema v2：漏报 confidence → 回落 0.5（低于阈值转 pending，不默认高置信掩盖）", () => {
  const bad = structuredClone(GOLD_FULL) as Record<string, unknown>;
  const fin = { ...(bad.finance as object) };
  delete (fin as Record<string, unknown>).confidence;
  bad.finance = fin;
  const r = FullExtractionV2.safeParse(bad);
  assert.ok(r.success); // 不再整包拒绝：其余合法字段保留
  assert.equal((r.data.finance as { confidence: number }).confidence, 0.5); // 0.5 < 0.6 阈值 → 转待确认
});

test("schema v2：finance hasAmount 缺金额 → 拒绝；todo applicable 缺 due → 拒绝；mood 有词缺分 → 拒绝", () => {
  const bad = structuredClone(GOLD_FULL);
  bad.finance.amountCents = null;
  assert.ok(!FullExtractionV2.safeParse(bad).success);
  const bad2 = structuredClone(GOLD_FULL);
  bad2.todo = { applicable: true, due: null, confidence: 0.9 };
  assert.ok(!FullExtractionV2.safeParse(bad2).success);
  const bad3 = structuredClone(GOLD_FULL);
  bad3.mood = { label: "开心", score: null, confidence: 0.9 };
  assert.ok(!FullExtractionV2.safeParse(bad3).success);
});

test("schema v2：饮食整句片段当食物名 → 拒绝", () => {
  const bad = structuredClone(GOLD_FULL);
  bad.diet = {
    applicable: true, meal: "加餐",
    items: [{ name: "今天喝了两杯黑咖啡两杯豆", amount: null, kcal: null }],
    totalKcal: null, confidence: 0.9,
  };
  const r = FullExtractionV2.safeParse(bad);
  assert.ok(!r.success);
});

test("schema v2：people 占位词（省略/无）→ 拒绝", () => {
  const bad = structuredClone(GOLD_FULL);
  bad.people = [{ name: "省略", event: null }];
  assert.ok(!FullExtractionV2.safeParse(bad).success);
});

test("schema v2：单域入口只校验目标域（diet 模式不管 schedule）", () => {
  const r = domainExtractionV2("diet").safeParse({
    reasoning: "ok",
    diet: { applicable: true, meal: "加餐", items: [{ name: "奶茶", amount: "1杯", kcal: 350 }], totalKcal: 350, confidence: 0.9 },
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues.slice(0, 2)));
  assert.ok(!domainExtractionV2("schedule").safeParse({ reasoning: "x", schedule: { applicable: true } }).success);
});

test("GlmError 分类：智谱业务码 1113/1302 → quota；429 → rate；401/1002 → auth；5xx → server", () => {
  assert.equal(classifyGlmFailure(429, '{"error":{"code":"1113"}}'), "quota");
  assert.equal(classifyGlmFailure(200, '{"error":{"code":"1302","message":"余额不足"}}'), "quota");
  assert.equal(classifyGlmFailure(429, "rate limited"), "rate");
  assert.equal(classifyGlmFailure(401, '{"error":{"code":"1002"}}'), "auth");
  assert.equal(classifyGlmFailure(500, "oops"), "server");
  assert.equal(classifyGlmFailure(null, "socket hang up"), "network");
});

test("engine 如实：forceRules → rules + fallbackReason；AI 主干的确定性后处理（区间→时长）", async () => {
  const r = await parseInput("今天14:30到15:30工作准备+喝水", { now: new Date(NOW), forceRules: true });
  assert.equal(r.engine, "rules");
  assert.equal(r.fallbackReason, "force-rules");
});
