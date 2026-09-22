/**
 * 3-D 混合引擎单测：Jev 闭集 + GLM 瘦身开放词汇 → 合并层 → ParseResult。
 * mock fetch 按 URL 分流：Jev SystemOne / GLM chat/completions。
 * 时间断言全部用 UTC 数学推导——宿主时区无关（TZ=UTC 与 TZ=Asia/Shanghai 下均应通过）。
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { parseHybridInput, HybridUnavailableError, toCstWallClock } from "../src/parse";
import type { JevQuestions } from "../src/jev";

// 环境门（hasApiKey/jevEnabled 在调用时读取）——测试只要求"非空"，fetch 全程 mock 不会真连
process.env.ZHIPUAI_API_KEY ??= "test-key";
process.env.TYPESAFE_API_KEY ??= "test-key";
process.env.JEV_MODE = "on";

// ---- 固定"当前时间"：2026-09-23T15:00（北京时间周四下午），与 PoC 同基准 ----
const NOW = new Date("2026-09-23T15:00:00+08:00");

const jevResponseFor = (overrides: Record<string, unknown> = {}) => ({
  model: "jev-latest",
  answers: {
    sched_applicable: { noul: 0.95 },
    todo_applicable: { noul: 0.05 },
    fin_applicable: { noul: 0.99 },
    mood_applicable: { noul: 0.9 },
    diet_applicable: { noul: 0.9 },
    people_applicable: { noul: 0.9 },
    activity: { choice: "social", probabilities: { social: 0.88, other: 0.04 } },
    record_type: { choice: "past", probabilities: { past: 0.97, future: 0.03 } },
    period: { choice: "noon", probabilities: { noon: 0.9 } },
    fin_direction: { choice: "income", probabilities: { income: 0.96, out: 0.04 } },
    fin_category: { choice: "人情往来", probabilities: { 人情往来: 0.93 } },
    diet_meal: { choice: "未知", probabilities: { 未知: 0.5 } },
    ...overrides,
  },
});

const glmSlimResponse = (content: unknown) => ({
  choices: [{ message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});

/** 安装 fetch mock；返回还原函数 */
let restore: (() => void) | null = null;
function mockFetch(jevAnswer: unknown, glmContent: unknown) {
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/v1/systemone")) {
      void init;
      return new Response(JSON.stringify(jevAnswer), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("chat/completions")) {
      return new Response(JSON.stringify(glmContent), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`mock: 未预期的请求 ${u}`);
  };
  mock.method(globalThis, "fetch", impl);
  restore = () => mock.restoreAll();
}

test("3-D 混合：闭集信 Jev、开放字段信 GLM，engine=jev-hybrid", async () => {
  mockFetch(
    jevResponseFor(),
    glmSlimResponse({
      title: "和老王吃火锅",
      start: "2026-09-23T12:00:00+08:00",
      end: "2026-09-23T13:10:00+08:00",
      due: null,
      durationMin: 70,
      people: [{ name: "老王", event: "吃火锅" }],
      dietItems: [{ name: "火锅", amount: null, kcal: null }],
      mood: { label: "开心", score: 60 },
      counterparty: "老王",
      amountCents: 32000,
    }),
  );
  const r = await parseHybridInput("中午和老王吃火锅花了320，聊得挺开心", { now: NOW });
  assert.equal(r.engine, "jev-hybrid");
  assert.equal(r.activity, "social");
  assert.equal(r.intent, "schedule");
  assert.equal(r.scheduleApplicable, true);
  assert.equal(r.scheduleConfidence, 0.95);
  assert.equal(r.title, "和老王吃火锅");
  // 财务：方向/分类/适用 信 Jev（income→in 映射），金额信 GLM
  assert.equal(r.finance.hasAmount, true);
  assert.equal(r.finance.direction, "in");
  assert.equal(r.finance.category, "人情往来");
  assert.equal(r.finance.amountCents, 32000);
  assert.equal(r.financeConfidence, 0.99);
  // 心情/饮食/人物：Jev 开闸 + GLM 出词
  assert.equal(r.mood.label, "开心");
  assert.equal(r.mood.score, 60);
  assert.equal(r.diet.applicable, true);
  assert.equal(r.diet.items.length, 1);
  assert.equal(r.people.length, 1);
  assert.equal(r.people[0].name, "老王");
  // 时间来自 GLM ISO，确定性换算后落 explicit 区间
  assert.equal(r.time.mode, "explicit");
  if (restore) restore();
});

test("3-D 混合：闭集否决 GLM 开放字段（mood/people/diet 关闸即空）", async () => {
  mockFetch(
    jevResponseFor({ mood_applicable: { noul: 0.1 }, people_applicable: { noul: 0.05 }, diet_applicable: { noul: 0.05 }, fin_applicable: { noul: 0.05 } }),
    glmSlimResponse({
      title: "楼下散步", start: "2026-09-23T14:00:00+08:00", end: "2026-09-23T14:30:00+08:00",
      mood: { label: "开心", score: 50 }, people: [{ name: "路人" }], dietItems: [{ name: "奶茶" }], amountCents: 100,
    }),
  );
  const r = await parseHybridInput("下午在楼下散步半小时，心情不错", { now: NOW });
  assert.equal(r.mood.label, null, "Jev 判无心情 → GLM 的 label 必须被否决");
  assert.equal(r.people.length, 0, "Jev 判无人物 → GLM 的人名必须被否决");
  assert.equal(r.diet.applicable, false, "Jev 判无饮食 → GLM 的条目必须被否决");
  assert.equal(r.finance.hasAmount, false, "Jev 判无金额 → 即便 GLM 抽出金额也按无金额");
  if (restore) restore();
});

test("3-D 混合：record_type=future 而 todo_applicable 漏答 → 仍按待办；Jev 概率进置信", async () => {
  mockFetch(
    jevResponseFor({
      todo_applicable: { noul: 0.02 },
      sched_applicable: { noul: 0.05 },
      record_type: { choice: "future", probabilities: { future: 0.99, past: 0.01 } },
    }),
    glmSlimResponse({ title: "去看牙医", due: "2026-09-24T09:00:00+08:00", people: [], dietItems: [] }),
  );
  const r = await parseHybridInput("明天上午九点去看牙医", { now: NOW });
  assert.equal(r.intent, "todo", "record_type=future 是待办的强信号");
  assert.equal(r.todoConfidence >= 0.9, true);
  assert.equal(r.time.mode, "future");
  if (restore) restore();
});

test("3-D 混合：Jev 调用失败 → HybridUnavailableError（调用方降级全量 GLM）", async () => {
  mock.method(globalThis, "fetch", async () => new Response("boom", { status: 500 }));
  await assert.rejects(
    () => parseHybridInput("随便一句", { now: NOW }),
    (e: unknown) => e instanceof HybridUnavailableError,
  );
  mock.restoreAll();
  restore = null;
});

test("3-D 混合：Jev 判有金额但 GLM 未抽出金额 → 宁漏勿错按无金额", async () => {
  mockFetch(
    jevResponseFor(),
    glmSlimResponse({ title: "买东西", people: [], dietItems: [], amountCents: null }),
  );
  const r = await parseHybridInput("中午买了个东西", { now: NOW });
  assert.equal(r.finance.hasAmount, false);
  if (restore) restore();
});

test("时区健壮性：toCstWallClock 输出与宿主时区无关（UTC 数学断言）", () => {
  const s = toCstWallClock(NOW);
  // 北京墙钟必须是 2026-09-23 15:00 —— 用 UTC 毫秒推到 +8h 再比对，任何宿主 TZ 下都应相等
  assert.match(s, /2026-09-23 15:00（北京时间）/);
  const shifted = new Date(NOW.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const expect = `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`;
  assert.ok(s.startsWith(expect), `${s} 应以 ${expect} 开头`);
});

/** 防止未使用导入告警（JevQuestions 仅类型引用） */
void (0 as unknown as JevQuestions);
