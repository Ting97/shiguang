/**
 * REQ-019 三批测试：阶段目标 CRUD/越权/聚合 + chat 分域（scope 白名单/会话隔离/工具域过滤）
 * + fitness 休息日规则与身高指标口径。与 sport-space 冒烟同约定：SHIGUANGRI_TEST_DB 不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const US = "22250000-2225-4222-8222-222500001181"; // 主测试用户
const UB = "22250000-2225-4222-8222-222500001182"; // 越权用户
const UA = "22250000-2225-4222-8222-222500001183"; // fitness 用户

let pool: any;
let milestoneService: any;
let spaceService: any;
let fitnessService: any;
let parseScope: any;
let toolsForScope: any;
let CHAT_TOOLS: any[];
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.space_milestones') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ milestoneService, spaceService } = await import("../src/server/goal"));
    ({ fitnessService } = await import("../src/server/fitness"));
    ({ parseScope, toolsForScope, CHAT_TOOLS } = await import("../src/server/chat"));
  }
}

async function upsertUser(id: string, nickname: string) {
  await pool.query(
    `insert into profiles (id, nickname) values ($1,$2) on conflict (id) do update set nickname = excluded.nickname`,
    [id, nickname],
  );
}

async function cleanup() {
  await pool.query(`delete from goal_spaces where user_id = any($1::uuid[])`, [[US, UB]]);
  await pool.query(`delete from chat_conversations where user_id = any($1::uuid[])`, [[US, UB]]);
  await pool.query(`delete from fitness_body_metrics where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
}

// ---- B1 阶段目标 ----

test("阶段目标：CRUD + 多 active 并行 + done 写 completed_at + 聚合计数", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(US, "milestone冒烟");
  await cleanup();
  const { rows: sp } = await pool.query(
    `insert into goal_spaces (user_id, name, icon) values ($1, '考研上岸', '📚') returning id`,
    [US],
  );
  const spaceId = sp[0].id;

  // 多 active 允许（用户决策：可多阶段并行）
  const m1 = (await milestoneService.create(US, spaceId, { title: "第一阶段：基础期", targetDate: "2026-12-31" })) as any;
  const m2 = (await milestoneService.create(US, spaceId, { title: "第二阶段：强化期" })) as any;
  assert.ok(m1.milestone.id && m2.milestone.id);
  assert.equal(m1.milestone.status, "active");

  // 空标题/超长 400
  await assert.rejects(() => milestoneService.create(US, spaceId, { title: "  " }), /不能为空/);
  await assert.rejects(() => milestoneService.create(US, spaceId, { title: "x".repeat(81) }), /80/);
  // 非法日期 400
  await assert.rejects(() => milestoneService.create(US, spaceId, { title: "x", targetDate: "2026-13-01" }), /真实存在/);

  // 越权：他用户空间 404；他用户 milestone 404
  await upsertUser(UB, "milestone越权");
  await assert.rejects(() => milestoneService.create(UB, spaceId, { title: "偷建" }), /空间不存在/);
  await assert.rejects(() => milestoneService.update(UB, m1.milestone.id, { status: "done" }), /不存在/);
  // 路径不一致：/spaces/他空间/milestones/<我的mid> 不生效
  const { rows: spB } = await pool.query(
    `insert into goal_spaces (user_id, name, icon) values ($1, '别人的空间', '🔒') returning id`,
    [UB],
  );
  await assert.rejects(() => milestoneService.update(UB, m1.milestone.id, { status: "done" }, spB[0].id), /不存在/);

  // done 写 completed_at；重开（active）清空
  const done = (await milestoneService.update(US, m1.milestone.id, { status: "done" })) as any;
  assert.equal(done.milestone.status, "done");
  assert.ok(done.milestone.completed_at, "达成应写 completed_at");
  const reopen = (await milestoneService.update(US, m1.milestone.id, { status: "active" })) as any;
  assert.equal(reopen.milestone.completed_at, null);

  // abandoned 状态合法
  const ab = (await milestoneService.update(US, m2.milestone.id, { status: "abandoned" })) as any;
  assert.equal(ab.milestone.status, "abandoned");

  // 列表：active 在前 + 历史保留
  const list = (await milestoneService.list(US, spaceId)) as any;
  assert.equal(list.milestones.length, 2);
  assert.equal(list.milestones[0].status, "active");

  // 聚合：spaceService.list 的 active_milestones/done_milestones
  const spaces = (await spaceService.list(US)) as any;
  const mine = spaces.spaces.find((s: any) => s.id === spaceId);
  assert.equal(mine.active_milestones, 1);
  assert.equal(mine.done_milestones, 0);
});

// ---- C 助手分域 ----

test("chat 分域：scope 白名单 + 工具域过滤（fitness 教练只见 fitness + 画像；global 全量）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");

  // 白名单外 400 / 缺省 global
  assert.throws(() => parseScope("hacker"), /scope/);
  assert.equal(parseScope(null), "global");
  assert.equal(parseScope("finance"), "finance");

  const allNames = CHAT_TOOLS.map((t: any) => t.name);
  assert.ok(allNames.length >= 23, "只读工具 ≥23");
  const globalTools = toolsForScope("global").map((t: any) => t.name);
  assert.ok(globalTools.includes("propose_fitness_plan"), "global 含提案工具");

  const fitnessTools = toolsForScope("fitness").map((t: any) => t.name);
  assert.ok(fitnessTools.includes("query_fitness_plans"));
  assert.ok(fitnessTools.includes("propose_fitness_plan"));
  assert.ok(fitnessTools.includes("get_user_profile"), "域助手带通用画像");
  assert.ok(!fitnessTools.includes("query_transactions"), "不得见他域工具");
  assert.ok(!fitnessTools.includes("query_contacts"));

  const goalTools = toolsForScope("goal").map((t: any) => t.name);
  assert.ok(goalTools.includes("query_todos") && goalTools.includes("query_goals"));
  assert.ok(!goalTools.includes("query_fitness_plans"), "目标管家不见健身工具");

  const financeTools = toolsForScope("finance").map((t: any) => t.name);
  assert.ok(financeTools.includes("query_debts") && financeTools.includes("query_trading"));
  assert.ok(!financeTools.includes("query_fitness_plans"));
});

test("chat 会话 scope：创建落域 + 列表按域过滤 + 串域提问 400", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(US, "chatScope冒烟");
  await cleanup();
  const { rows: conv } = await pool.query(
    `insert into chat_conversations (user_id, title, scope) values ($1, '教练会话', 'fitness') returning id`,
    [US],
  );
  await pool.query(`insert into chat_conversations (user_id, title, scope) values ($1, '全局会话', 'global')`, [US]);

  // 列表按域过滤
  const m: any = await import("../src/server/chat");
  const fitConvs = (await m.chatService.listConversations(US, "fitness")).conversations;
  assert.equal(fitConvs.length, 1);
  assert.equal(fitConvs[0].title, "教练会话");

  // 串域提问：向 fitness 会话传 scope=goal → 400
  await assert.rejects(
    () => m.chatService.sendMessage(US, { conversationId: conv[0].id, text: "你好", scope: "goal" }),
    /会话域不匹配/,
  );

  // 清理
  await pool.query(`delete from chat_conversations where user_id = $1`, [US]);
});

// ---- A1/A3 fitness ----

test("fitness：休息日规则命中 + 身高/体脂指标 round-trip", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness019冒烟");

  // 休息日：短文本命中 → 400 且不耗 AI（parsePlanDraft 入口短路）
  await assert.rejects(() => fitnessService.parsePlanDraft(UA, "无安排"), /休息日/);
  await assert.rejects(() => fitnessService.parsePlanDraft(UA, "今天休息日"), /休息日/);
  await assert.rejects(() => fitnessService.parsePlanDraft(UA, "rest"), /休息日/);
  // 长文本含关键词不短路（交给 AI 判定）——「这周无安排，明天课表如下：…」超过 30 字
  // （不真实调 AI：仅验证不抛休息日 400，而是走后续流程抛配额/鉴权类错误）
  const longText = "这周无安排，明天课表如下：热身 1 公里，主课 6×400 米，放松 1 公里";
  await assert.rejects(() => fitnessService.parsePlanDraft(UA, longText), (e: any) => !/休息日/.test(String(e?.message)));

  // 指标 round-trip：身高/体脂/腰围（88cm → 880mm → 展示 88）
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const saved = (await fitnessService.saveMetric(UA, {
    measuredOn: day,
    weightKg: 68.4,
    waistCm: 88,
    heightCm: 172,
    bodyFatPct: 18.5,
  })) as any;
  assert.equal(saved.metric.waist_mm, 880, "88cm 存 880mm");
  assert.equal(saved.metric.height_mm, 1720, "172cm 存 1720mm");
  assert.equal(saved.metric.body_fat_pct_x10, 185, "18.5% 存 185");

  const from = new Date(Date.now() + 8 * 3600_000 - 3 * 86_400_000).toISOString().slice(0, 10);
  const { metrics } = (await fitnessService.listMetrics(UA, from, day)) as any;
  const row = metrics.find((m: any) => m.measured_on === day);
  assert.equal(row.height_mm, 1720);
  assert.equal(row.body_fat_pct_x10, 185);

  // 越界 400
  await assert.rejects(() => fitnessService.saveMetric(UA, { measuredOn: day, heightCm: 300 }), /heightCm/);
  await assert.rejects(() => fitnessService.saveMetric(UA, { measuredOn: day, bodyFatPct: 90 }), /bodyFatPct/);
});
