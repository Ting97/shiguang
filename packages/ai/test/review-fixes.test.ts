/**
 * 全量检视修复回归（2026-10-08 批次）：
 * occurredDate 月限定/溢出、时长惯用语误命中、1万2 尾数、全角数字、
 * SDK 传输 quota 分类、锚定 diff≥2 跨午夜、心情否定变体、llmConfidence null。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { parseDuration, parseAmountCents } from "../src/duration.js";
import { deterministicOccurredDate, parseInput } from "../src/parse.js";
import { classifyGlmFailure } from "../src/glm.js";
import { anchorRangeToToday, inferTimeBlock } from "../src/time-infer.js";
import { ruleMood } from "../src/mood-rules.js";
import { FinanceDraft, FinanceDraftV2, ScheduleDraftV2 } from "../src/schema.js";
import { jevAsk, qNoul } from "../src/jev.js";

const NOW = new Date("2026-10-08T15:00:00+08:00"); // 北京 2026-10-08（周四）15:00
const CST = (s: string) => new Date(s).getTime(); // 参照：带偏移的 ISO 串的绝对时刻

/* ---- P0：occurredDate 带月/年限定不再被裸「N号」覆盖成错误日期 ---- */

test("occurredDate：「M月N号」确定性解析（未带年份且未来 → 按去年）", () => {
  assert.equal(deterministicOccurredDate("10月1号转了1000", NOW), "2026-10-01"); // 今年已过（10-08 说）→ 今年
  assert.equal(deterministicOccurredDate("12月1号转了1000", NOW), "2025-12-01"); // 今年未到 → 去年
  assert.equal(deterministicOccurredDate("2025年12月31号买的票", NOW), "2025-12-31");
  assert.equal(deterministicOccurredDate("9月20日吃饭花了80", NOW), "2026-09-20"); // 今年已过 → 今年
});

test("occurredDate：裸「N号」——本月已过取本月，未来回退到存在的最近月份（不再溢出未来日期）", () => {
  assert.equal(deterministicOccurredDate("5号交了水电费", NOW), "2026-10-05");
  assert.equal(deterministicOccurredDate("20号买的药", NOW), "2026-09-20"); // 20 > 今天 8 号 → 上月
  // 2026-03-15 说「30号/31号」：2 月没有 30/31 日 → 回退到 1 月（旧版 Date.UTC 进位出 3 月的未来日期）
  const mar = new Date("2026-03-15T15:00:00+08:00");
  assert.equal(deterministicOccurredDate("30号买的", mar), "2026-01-30");
  assert.equal(deterministicOccurredDate("31号买的", mar), "2026-01-31");
});

/* ---- P0/P1：时长惯用语不再吞掉显式时长/周X ---- */

test("parseDuration：「周一下午/周X上午」不再误命中「一下午/一上午」惯用语", () => {
  assert.equal(parseDuration("周一下午去看了牙医"), null);
  assert.equal(parseDuration("周一上午开了会"), null);
  assert.equal(parseDuration("礼拜天半天都在外头"), null);
  // 无周限定的惯用语照常
  assert.equal(parseDuration("弄了一下午"), 240);
  assert.equal(parseDuration("忙了一上午"), 240);
});

test("parseDuration：显式数字时长优先于惯用语（「周一下午开了3小时会」=180 非 240）", () => {
  assert.equal(parseDuration("周一下午开了3小时会"), 180);
  assert.equal(parseDuration("上午开了2小时会"), 120);
});

/* ---- P1：「花了1万2」不再回溯成 1 元 ---- */

test("parseAmountCents：口语尾数「1万2」=120万分、「2千5」=25万分", () => {
  assert.equal(parseAmountCents("花了1万2买手机"), 1_200_000);
  assert.equal(parseAmountCents("花了2千5请客"), 250_000);
  assert.equal(parseAmountCents("花了1万"), 1_000_000); // 无尾数回归
  assert.equal(parseAmountCents("花了12"), 1200); // 裸数字不被拆成 1+2
});

/* ---- REQ-011 回归：N号 量词前缀不再误判日期 + 红包方向 + 一小时半 ---- */

test("deterministicOccurredDate：「件3号球衣」的 3号 是编号不是日期（量词前缀宁缺勿错）", () => {
  assert.equal(deterministicOccurredDate("买件3号球衣花了200", NOW), null);
  assert.equal(deterministicOccurredDate("3号交了房租", NOW), "2026-10-03"); // 无量词前缀回归
  // 记录待办：「领了5号工牌」类后置名词编号仍会误判（后向名词黑名单会误伤「3号生日」，需词性判断另起批次）
});

test("parseDuration：「一小时半/两小时半」补半 30 分钟；「两小时半马」不受影响", () => {
  assert.equal(parseDuration("开了一小时半的会"), 90);
  assert.equal(parseDuration("两小时半的课"), 150);
  assert.equal(parseDuration("跑了两小时半马"), 120); // 半马非「半」
});

/* ---- REQ-011 P1：「N万/N千＋元/块」不再被 lookahead 回溯缩水成裸数字 ---- */

test("parseAmountCents：'1万元'=100万分、'2千块'=20万分、'1万2千元'=120万分（带单位量词）", () => {
  assert.equal(parseAmountCents("花了1万元"), 1_000_000); // 旧版回溯成 1 元（100 分）
  assert.equal(parseAmountCents("花了2千元"), 200_000);
  assert.equal(parseAmountCents("花了3千块"), 300_000);
  assert.equal(parseAmountCents("充值1万元"), 1_000_000);
  assert.equal(parseAmountCents("花了1.5万元"), 1_500_000); // 小数 + 量词
  assert.equal(parseAmountCents("花了1万2千元"), 1_200_000); // 尾数千位：1万+2千
  assert.equal(parseAmountCents("600块"), 60_000); // 无量词带单位回归
});

/* ---- P2：全角数字/符号归一 ---- */

test("全角数字与全角￥：２６０元 / ￥26.8 正常解析", () => {
  assert.equal(parseAmountCents("午饭花了２６０元"), 26_000);
  assert.equal(parseAmountCents("￥26.8"), 2680);
  assert.equal(parseDuration("３小时"), 180);
});

/* ---- P0：SDK 传输错误分类依据 responseBody（quota 熔断不再死代码） ---- */

test("classifyGlmFailure：1113/1302 业务码（含在响应体中）→ quota", () => {
  assert.equal(classifyGlmFailure(200, '{"error":{"code":"1113","message":"资源包已用尽"}}'), "quota");
  assert.equal(classifyGlmFailure(400, '{"code":"1302","message":"账户余额不足"}'), "quota");
  assert.equal(classifyGlmFailure(429, "rate limited"), "rate");
  assert.equal(classifyGlmFailure(401, "unauthorized"), "auth");
});

/* ---- P1：锚定 diff≥2 的跨午夜区间（终点今天）不再平移出未来块 ---- */

test("anchorRangeToToday：diff=2 跨午夜且终点今天 → 保留（终点贴今天优先于起点日差）", () => {
  // 北京 10-08 07:00 说「10点半到6点半睡觉」：模型漂成 10-06 22:30 → 10-08 06:30（diff=2，终点今天）
  const now = new Date("2026-10-07T23:00:00Z"); // 北京 10-08 07:00
  const range = {
    start: new Date("2026-10-06T22:30:00+08:00"),
    end: new Date("2026-10-08T06:30:00+08:00"),
  };
  const r = anchorRangeToToday(range, "睡觉", now);
  assert.equal(r.start.getTime(), range.start.getTime(), "终点落今天 → 是昨晚的真实记录，不平移");
  assert.equal(r.end.getTime(), range.end.getTime());
});

/* ---- P2：心情否定变体「没什么难过」「没怎么累」 ---- */

test("ruleMood：没(什么/怎么)+情绪词 也是否定", () => {
  assert.deepEqual(ruleMood("没什么难过"), null);
  assert.deepEqual(ruleMood("没怎么累"), null);
  assert.deepEqual(ruleMood("今天很开心"), { label: "开心", score: 60 }); // 未否定回归
});

/* ---- P2：llmConfidence null → 0.5（z.coerce 会把 null 转成 0） ---- */

test("llmConfidence：null 回落 0.5 而非 0", () => {
  const r = ScheduleDraftV2.parse({
    applicable: true, activity: "study", title: "背单词",
    start: "2026-10-09T08:00", end: "2026-10-09T08:40",
    confidence: null,
  });
  assert.equal(r.confidence, 0.5);
});

/* ---- 检视：occurredDate 相对日词表与日程域 detectDayRef 同源 ----
 * 旧版自维护词表缺「礼拜」「昨夜/昨儿」：「上礼拜五随了600」按今天记账，同句日程域却正确锚到上周五 —— 财务/日程分裂 */

test("occurredDate：上礼拜五/上周一/上周日 与日程日锚同源（NOW=周四）", () => {
  assert.equal(deterministicOccurredDate("上礼拜五随了600", NOW), "2026-10-02"); // 上周五
  assert.equal(deterministicOccurredDate("上周一交了房租", NOW), "2026-09-28");
  assert.equal(deterministicOccurredDate("上周日随了份子", NOW), "2026-10-04");
});

test("occurredDate：昨天/昨晚/大前天回归（同源替换后语义不变）", () => {
  assert.equal(deterministicOccurredDate("昨天打车花了30", NOW), "2026-10-07");
  assert.equal(deterministicOccurredDate("昨晚看电影花了50", NOW), "2026-10-07");
  assert.equal(deterministicOccurredDate("大前天买的药", NOW), "2026-10-05");
});

test("occurredDate 与日程日锚同源：同句「上礼拜五随了600」日程块也落上周五 20:00", () => {
  const tb = inferTimeBlock("上礼拜五随了600", NOW, 60);
  assert.equal(tb.start.getTime(), CST("2026-10-02T20:00:00+08:00"));
});

test("规则兜底：「上礼拜五随了600」occurredDate=上周五（不再按今天记账）", async () => {
  const r = await parseInput("上礼拜五随了600", { now: NOW, forceRules: true });
  assert.equal(r.finance.hasAmount, true);
  assert.equal(r.finance.amountCents, 60000);
  assert.equal(r.finance.occurredDate, "2026-10-02");
});

/* ---- 检视：M月N号/裸N号 带月限定回归（相对日同源替换不得吞掉日期分支） ---- */

test("occurredDate：月限定/裸N号 分支在 detectDayRef 同源后照常工作", () => {
  assert.equal(deterministicOccurredDate("10月1号转了1000", NOW), "2026-10-01");
  assert.equal(deterministicOccurredDate("5号交了水电费", NOW), "2026-10-05");
  assert.equal(deterministicOccurredDate("买件3号球衣花了200", NOW), null); // 编号非日期
});

/* ==================== 十轮检视修复回归（2026-10-21 批次） ==================== */

/* ---- P1：「下周三交房租」未来星期话术不再被 detectDayRef 当过去语境偏移 -7 天覆盖模型输出 ----
 * 旧版：detectDayRef 的周X 词表只认 (上)? 前缀，「下周三」的 周三 段按本周已过周三算出 -1 天，
 * 且 deterministicOccurredDate 在 mapAiResult 无条件覆盖模型输出 → 未来花销记成昨天 */

test("occurredDate：「下周三/下礼拜五」未来话术 → null（旧版错偏成过去日）", () => {
  // NOW=2026-10-08（周四）：旧版把「下周三」算成 2026-10-07（昨天）
  assert.equal(deterministicOccurredDate("下周三交房租500块", NOW), null);
  assert.equal(deterministicOccurredDate("下礼拜五随礼600", NOW), null);
  assert.equal(deterministicOccurredDate("明天交房租", NOW), null); // 未来话术守卫同口径
});

test("occurredDate：过去星期话术不受未来守卫影响（回归）", () => {
  assert.equal(deterministicOccurredDate("上周三交房租500", NOW), "2026-09-30"); // 上周三
  assert.equal(deterministicOccurredDate("周三交了水电费", NOW), "2026-10-07"); // 本周已过的周三
  assert.equal(deterministicOccurredDate("今天交了房租", NOW), "2026-10-08"); // 当日词先行命中，不被守卫吞掉
});

test("规则兜底：「下周三交房租500块」occurredDate=null（不再产出错误过去日）", async () => {
  const r = await parseInput("下周三交房租500块", { now: NOW, forceRules: true });
  assert.equal(r.intent, "todo"); // 未来话术归待办
  assert.equal(r.finance.hasAmount, true);
  assert.equal(r.finance.amountCents, 50000);
  assert.equal(r.finance.occurredDate, null); // 交回模型/按当天记，不再是 2026-10-07
});

/* ---- P2：occurredDate 形状 regex 不查真实日历（2026-02-30 可过形状且 JS 静默进位成 3 月 2 日）---- */

test("occurredDate：假日历日静默置 null，真实日历日回归", () => {
  // JS 对 2026-02-30 并非 Invalid Date：静默进位成 3 月 2 日 → 必须回读比对年月日
  assert.equal(FinanceDraftV2.parse({ hasAmount: false, occurredDate: "2026-02-30", confidence: 0.9 }).occurredDate, null);
  assert.equal(FinanceDraftV2.parse({ hasAmount: false, occurredDate: "2026-13-01", confidence: 0.9 }).occurredDate, null);
  assert.equal(FinanceDraftV2.parse({ hasAmount: false, occurredDate: "not-a-date", confidence: 0.9 }).occurredDate, null);
  assert.equal(FinanceDraftV2.parse({ hasAmount: false, occurredDate: "2024-02-29", confidence: 0.9 }).occurredDate, "2024-02-29"); // 闰年真实日回归
  assert.equal(FinanceDraftV2.parse({ hasAmount: false, occurredDate: null, confidence: 0.9 }).occurredDate, null); // nullish 回归
  // ParseResult 输出层（FinanceDraft）同口径
  assert.equal(FinanceDraft.parse({ hasAmount: false, occurredDate: "2026-02-30" }).occurredDate, null);
  assert.equal(FinanceDraft.parse({ hasAmount: false, occurredDate: "2026-10-08" }).occurredDate, "2026-10-08");
});

/* ---- P2：「花了0元」不再产出 0 分流水（FinanceDraft>0 refine + ruleExtract/rulesPipeline 双保险）---- */

test("FinanceDraft：0/负分金额拒收（ParseResult 契约恒为正数或空）", () => {
  assert.equal(FinanceDraft.safeParse({ hasAmount: true, amountCents: 0 }).success, false);
  assert.equal(FinanceDraft.safeParse({ hasAmount: true, amountCents: -5 }).success, false);
  assert.equal(FinanceDraft.safeParse({ hasAmount: false, amountCents: null }).success, true);
  assert.equal(FinanceDraft.safeParse({ hasAmount: true, amountCents: 3000 }).success, true); // 正金额回归
});

test("规则兜底：「花了0元」hasAmount=false（不再产出 0 分流水）", async () => {
  assert.equal(parseAmountCents("花了0元"), 0); // 底层解析仍返回 0——守卫在 ruleExtract/schema 两层
  const r = await parseInput("今天花了0元", { now: NOW, forceRules: true });
  assert.equal(r.finance.hasAmount, false);
  assert.equal(r.finance.amountCents, null);
  const pos = await parseInput("今天花了30元", { now: NOW, forceRules: true }); // 正金额回归
  assert.equal(pos.finance.hasAmount, true);
  assert.equal(pos.finance.amountCents, 3000);
});

/* ---- P2：规则路径 durationMin ≥1 钳制 + 规则分支纳入兜底（ZodError 不再逃逸 parseInput）---- */

test("规则兜底：defaults 配 0 时 durationMin 钳到 ≥1（与 mapAiResult 同口径，不再撞 zod 契约）", async () => {
  const r = await parseInput("随便待了会儿", { now: NOW, forceRules: true, defaults: { other: 0 } });
  assert.ok(r.time.durationMin >= 1, `durationMin=${r.time.durationMin} 必须 ≥1`);
});

test("parseInput：规则路径垃圾/边界输入不抛出（空 ParseResult 兜底，打卡入口不可失败的底线）", async () => {
  for (const t of ["", " ", "%$#@！", "。。。"]) {
    const r = await parseInput(t, { now: NOW, forceRules: true });
    assert.equal(r.engine, "rules");
    assert.equal(r.intent, "status");
    assert.ok(r.time.durationMin >= 1);
  }
});

/* ---- P3：Jev noul 概率越界（0~100）不再整包 badResponse ---- */

test("jevAsk：noul=99 归一为 0.99；归一后仍越界按缺失（null）处理，整包不失败", async () => {
  process.env.TYPESAFE_API_KEY ??= "test-key";
  const impl = async () =>
    new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: { a: { noul: 99 }, b: { noul: 0.4 }, c: { noul: 250 } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  mock.method(globalThis, "fetch", impl);
  try {
    const r = await jevAsk("state", { a: qNoul("a"), b: qNoul("b"), c: qNoul("c") });
    assert.equal(r.answers.a.value, true);
    assert.equal(r.answers.a.probabilities?.true, 0.99); // 0~100 口径按 /100 归一
    assert.equal(r.answers.b.value, false); // 0~1 原值回归
    assert.equal(r.answers.b.probabilities?.true, 0.4);
    assert.equal(r.answers.c.value, null); // 250→2.5 仍越界 → null 按缺失处理
  } finally {
    mock.restoreAll();
  }
});

/* ---- 十三轮：月历锚「月初/月底」+ 显式年份未来守卫 ---- */

test("occurredDate：「(上|本)个月初/底/末」确定性换算（宁缺勿错：未来落点 → null）", () => {
  assert.equal(deterministicOccurredDate("上个月底随了600", NOW), "2026-09-30");
  assert.equal(deterministicOccurredDate("上个月初随了600", NOW), "2026-09-01");
  assert.equal(deterministicOccurredDate("本月初交了200", NOW), "2026-10-01");
  // 本月底相对 NOW(10-08) 是未来 → null（不得预记未发生的花销）
  assert.equal(deterministicOccurredDate("这个月底交房租", NOW), null);
});

test("occurredDate：带显式年份的未来日期返回 null（「2027年1月1号」违反发生日必为过去）", () => {
  assert.equal(deterministicOccurredDate("2027年1月1号转了1000", NOW), null);
  assert.equal(deterministicOccurredDate("2026年1月1号转了1000", NOW), "2026-01-01"); // 历史年份不受影响
});

/* ---- 十五轮：锚定平移进过去的 due 兜底 now+1h（AI 判未来、话术无日期词、模型给的钟点早于当前） ---- */

test("mapAiResult：due 被锚定拉回今天已过期 → 兜底 now+1h（不再立即弹过期待办）", async () => {
  process.env.ZHIPUAI_API_KEY ??= "test-key";
  const glm = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: {},
                schedule: { applicable: false, activity: "other", title: "", durationMin: null, periodHint: null, confidence: 0.9 },
                todo: { applicable: true, due: "2026-10-09T09:00:00+08:00", confidence: 0.9 },
                finance: { hasAmount: false, direction: null, amountCents: null, category: null, counterparty: null, confidence: 0.9 },
                mood: { label: null, score: null, confidence: 0.9 },
                diet: { applicable: false, meal: "未知", items: [], totalKcal: null, confidence: 0.9 },
                people: [],
                ambiguity: null,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  mock.method(globalThis, "fetch", glm);
  try {
    // 「买牛奶」无任何日期词：模型给的明天 9 点被 anchorMomentToToday 拉回今天 9 点（早于 NOW 15:00）
    const r = await parseInput("买牛奶", { now: NOW });
    assert.equal(r.intent, "todo");
    assert.equal(new Date(r.time.start).getTime(), CST("2026-10-08T16:00:00+08:00")); // NOW+1h，非已过期的 9 点
  } finally {
    mock.restoreAll();
  }
});
