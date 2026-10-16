/**
 * fitness 域冒烟（REQ-016）：服务 CRUD + 今日行动联动（幂等/重建/清理/打卡同步）
 * + A.5 提案工具只写 chat_proposals 不写业务表 + 确认卡 accept/dismiss 闭环 + 越权隔离。
 * 与 chat-tools 冒烟同约定：SHIGUANGRI_TEST_DB 不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UA = "22250000-2225-4222-8222-222500001161"; // fitness 冒烟用户
const UB = "22250000-2225-4222-8222-222500001162"; // 越权隔离用户

// REQ-022 起力量计划落库会走训记名对齐：本文件断言动作名/行动标题原文，
// 禁止真实目录泄入（shell 若 source 过 .env 会带出 XUNJI_API_KEY 触发真实外呼+改名）
delete process.env.XUNJI_API_KEY;

let pool: any;
let fitnessService: any;
let chatService: any;
let CHAT_PROPOSAL_TOOLS: any;
let draftToCanonicalPlan: any;
let parsePaceText: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.fitness_daily_plans') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ fitnessService } = await import("../src/server/fitness"));
    ({ draftToCanonicalPlan, parsePaceText } = await import("../src/server/fitness"));
    ({ chatService } = await import("../src/server/chat/service"));
    ({ CHAT_PROPOSAL_TOOLS } = await import("../src/server/chat/tools"));
  }
}

async function upsertUser(id: string, nickname: string) {
  await pool.query(
    `insert into profiles (id, nickname) values ($1,$2) on conflict (id) do update set nickname = excluded.nickname`,
    [id, nickname],
  );
}

const todayStr = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

async function cleanup() {
  await pool.query(`delete from fitness_daily_plans where user_id = any($1::uuid[])`, [[UA, UB]]);
  // 执行记录不随计划级联（REQ-021 删除转独立历史），测试自行清理防跨用例残留
  await pool.query(`delete from fitness_session_logs where user_id = any($1::uuid[])`, [[UA, UB]]);
  await pool.query(`delete from fitness_goals where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_body_metrics where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [UA]);
  await pool.query(`delete from chat_proposals where user_id = $1`, [UA]);
  await pool.query(`delete from chat_conversations where user_id = $1`, [UA]);
}

test("纯函数：配速文本解析 + 草稿→整数口径映射", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  assert.equal(parsePaceText("5'50\""), 350);
  assert.equal(parsePaceText("6:15"), 375);
  assert.equal(parsePaceText("6:00-6:15"), 360, "区间取首值");
  assert.equal(parsePaceText("5分50"), 350);
  assert.equal(parsePaceText("随便"), null);

  const canonical = draftToCanonicalPlan({
    module: "run",
    run: {
      workoutType: "interval",
      title: "间歇 8 公里",
      segments: [{ label: "6×400m", distanceKm: 0.4, reps: 6, paceText: "5'20\"" }],
      totalDistanceKm: 8,
      durationMin: 50,
    },
    confidence: 0.9,
  } as any) as any;
  assert.equal(canonical.moduleCode, "run");
  assert.equal(canonical.content.segments[0].distanceM, 400);
  assert.equal(canonical.content.segments[0].paceSPerKm, 320);
  assert.equal(canonical.content.totalDistanceM, 8000);

  // REQ-020 佳明截图字段：分段时长 + bpm 区间原文透传（不折算 hrZone）；力量总时长
  const garminRun = draftToCanonicalPlan({
    module: "run",
    run: {
      workoutType: "tempo",
      title: "乳酸阈值",
      segments: [
        { label: "热身", durationMin: 10, hrBpmText: "134-161" },
        { label: "跑步", durationMin: 15, hrBpmText: "170-180" },
      ],
      durationMin: 35,
    },
    confidence: 0.95,
  } as any) as any;
  assert.equal(garminRun.content.segments[0].durationMin, 10);
  assert.equal(garminRun.content.segments[1].hrBpmText, "170-180");
  assert.equal(garminRun.content.segments[1].hrZone, null);
  assert.equal(garminRun.content.durationMin, 35);

  const garminStrength = draftToCanonicalPlan({
    module: "strength",
    strength: {
      title: "全身循环3",
      exercises: [{ name: "臀桥", sets: 3, repsText: "40s", weightKg: 0 }],
      durationMin: 25,
    },
    confidence: 0.95,
  } as any) as any;
  assert.equal(garminStrength.content.exercises[0].weightG, 0, "体重=自重存 0（前端不展示）");
  assert.equal(garminStrength.content.durationMin, 25);

  const strength = draftToCanonicalPlan({
    module: "strength",
    strength: { title: "课A", exercises: [{ name: "高脚杯深蹲", sets: 3, repsText: "10-12", weightKg: 16 }] },
    confidence: 0.9,
  } as any) as any;
  assert.equal(strength.content.exercises[0].weightG, 16000, "kg→g");
});

test("REQ-020 截图入参守卫：MIME 白名单/base64/体积 + 空文本带图放行到 AI 层", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");

  // 文本与截图都为空 → 400
  await assert.rejects(() => fitnessService.parsePlanDraft(UA, ""), /至少提供一项/);
  // MIME 白名单
  await assert.rejects(
    () => fitnessService.parsePlanDraft(UA, "", { mimeType: "image/bmp", base64: "a".repeat(200) }),
    /仅支持/,
  );
  // base64 字符集
  await assert.rejects(
    () => fitnessService.parsePlanDraft(UA, "", { mimeType: "image/jpeg", base64: "不!!合法##" }),
    /不合法/,
  );
  // 体积上限（解码后 >6MB）
  await assert.rejects(
    () => fitnessService.parsePlanDraft(UA, "", { mimeType: "image/jpeg", base64: "a".repeat(9 * 1024 * 1024) }),
    /过大/,
  );
  // 空文本 + 合法截图：通过入参守卫，走到 AI 层抛配额/鉴权类错误（不真实调 AI）
  await assert.rejects(
    () => fitnessService.parsePlanDraft(UA, "", { mimeType: "image/jpeg", base64: "a".repeat(200) }),
    (e: any) => !/至少提供一项|仅支持|不合法|过大/.test(String(e?.message)),
  );
  // 附图时休息日文本不短路（文字可能只是补充说明）
  await assert.rejects(
    () => fitnessService.parsePlanDraft(UA, "休息日", { mimeType: "image/jpeg", base64: "a".repeat(200) }),
    (e: any) => !/休息日/.test(String(e?.message)),
  );
});

test("计划保存 → 今日行动联动（父任务+子行动）；同日同模块多条并存（REQ-021）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  await cleanup();
  // 预设「健身」活动行（正式注册用户由注册流程播种；直插 profiles 的测试用户需补种）
  await pool.query(
    `insert into activities (id, user_id, name) values ('fitness', $1, '健身') on conflict (id, user_id) do nothing`,
    [UA],
  );
  const today = todayStr();

  // 力量计划：应生成 1 父任务 + 3 子行动，动作挂动作库 id、活动挂 fitness 预设
  const saved = (await fitnessService.savePlanDraft(UA, {
    planDate: today,
    moduleCode: "strength",
    source: "import",
    content: {
      title: "力量课 A · 推+轻腿",
      exercises: [
        { name: "高脚杯深蹲", sets: 3, repsText: "10-12" },
        { name: "哑铃卧推", sets: 3, repsText: "8-12", weightG: 30000 },
        { name: "侧平举", sets: 2, repsText: "12-15" },
      ],
    },
  })) as any;
  assert.equal(saved.syncedActions, 4, "父任务 + 3 子行动");
  const planId = saved.plan.id;

  let { rows: linked } = await pool.query(`select * from todos where fitness_plan_id = $1 order by sort`, [planId]);
  assert.equal(linked.length, 4);
  const parent = linked.find((r: any) => r.parent_todo_id === null);
  assert.equal(parent.kind, "todo");
  assert.equal(parent.activity_id, "fitness", "联动行动应挂 fitness 活动分类");
  assert.equal(linked.filter((r: any) => r.kind === "action").length, 3);
  assert.equal(linked[1].title, "高脚杯深蹲 3×10-12");
  assert.equal(linked[2].title, "哑铃卧推 30kg×3×8-12");

  // 再保存（同日同模块）→ REQ-021：新增第二条计划并存，各自联动行动独立
  const second = (await fitnessService.savePlanDraft(UA, {
    planDate: today,
    moduleCode: "strength",
    source: "import",
    content: {
      title: "力量课 A · 推+轻腿（晚练）",
      exercises: [
        { name: "高脚杯深蹲", sets: 3, repsText: "10-12" },
        { name: "哑铃卧推", sets: 3, repsText: "8-12", weightG: 32500 },
      ],
    },
  })) as any;
  assert.notEqual(second.plan.id, planId, "第二次保存应新增计划而非覆盖");
  assert.equal(second.syncedActions, 3, "第二条计划独立联动（1 父 + 2 子）");
  ({ rows: linked } = await pool.query(`select * from todos where fitness_plan_id = $1`, [planId]));
  assert.equal(linked.length, 4, "原计划行动不受影响");
  const { rows: plans } = await pool.query(
    `select * from fitness_daily_plans where user_id = $1 and plan_date = $2 and module_code = 'strength'`,
    [UA, today],
  );
  assert.equal(plans.length, 2, "同日同模块两条计划并存");
});

test("计划状态机：确认 → 打卡落执行记录 + 行动自动完成；skipped 清理", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  const today = todayStr();

  // 跑步计划：单条独立行动
  const run = (await fitnessService.savePlanDraft(UA, {
    planDate: today,
    moduleCode: "run",
    source: "manual",
    content: {
      workoutType: "easy",
      title: "轻松跑",
      segments: [{ label: "主课", distanceM: 6000, paceSPerKm: 390 }],
      totalDistanceM: 6000,
      durationMin: 40,
    },
  })) as any;
  assert.equal(run.syncedActions, 1, "跑步课单条行动");
  let { rows: runTodos } = await pool.query(`select * from todos where fitness_plan_id = $1`, [run.plan.id]);
  assert.equal(runTodos.length, 1);
  assert.equal(runTodos[0].kind, "action");

  // 已 confirmed 后再 POST → REQ-021：新增并存（旧 409 废止）
  await fitnessService.updatePlan(UA, run.plan.id, { status: "confirmed" });
  const second = (await fitnessService.savePlanDraft(UA, {
    planDate: today, moduleCode: "run", source: "manual",
    content: { workoutType: "easy", title: "傍晚轻松跑", segments: [] },
  })) as any;
  assert.notEqual(second.plan.id, run.plan.id, "confirmed 后仍可新增同模块计划");

  // 打卡：落执行记录 + 行动置完成
  const checked = (await fitnessService.updatePlan(UA, run.plan.id, {
    status: "done",
    actual: { distanceM: 6200, durationS: 2400, avgHr: 148 },
    fatigue: 5,
    sleepHours: 7,
  })) as any;
  assert.equal(checked.plan.status, "done");
  const { rows: logs } = await pool.query(`select * from fitness_session_logs where plan_id = $1`, [run.plan.id]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actual.distanceM, 6200);
  assert.equal(logs[0].sleep_h_x10, null, "REQ-024 起打卡不写 session_logs 睡眠列");
  const { rows: sleepRows } = await pool.query(`select sleep_h_x10, source from fitness_sleep_logs where user_id = $1 and log_date = $2`, [UA, today]);
  assert.equal(sleepRows[0]?.sleep_h_x10, 70, "打卡兼容入参落到独立睡眠表");
  assert.equal(sleepRows[0]?.source, "checkin");
  ({ rows: runTodos } = await pool.query(`select * from todos where fitness_plan_id = $1`, [run.plan.id]));
  assert.equal(runTodos[0].status, "done", "打卡后联动行动应自动完成");
  assert.ok(runTodos[0].done_at, "done_at 应写入");

  // 已打卡不可再改
  await assert.rejects(() => fitnessService.updatePlan(UA, run.plan.id, { status: "skipped" }), /已打卡/);

  // skipped：清理未完成行动
  const s2 = (await fitnessService.savePlanDraft(UA, {
    planDate: today,
    moduleCode: "strength",
    source: "manual",
    content: { title: "课C", exercises: [{ name: "平板支撑", sets: 3, repsText: "45s" }] },
  })) as any;
  await fitnessService.updatePlan(UA, s2.plan.id, { status: "skipped" });
  const { rows: left } = await pool.query(`select * from todos where fitness_plan_id = $1`, [s2.plan.id]);
  assert.equal(left.length, 0, "skipped 应清理联动行动");
});

test("REQ-021 删除计划：草稿删（行动级联清理）；已打卡删（执行记录保留为独立历史）；越权 404", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  await upsertUser(UB, "fitness冒烟B");
  await cleanup();
  const today = todayStr();

  // 草稿删除：联动行动级联清理
  const draft = (await fitnessService.savePlanDraft(UA, {
    planDate: today, moduleCode: "strength", source: "import",
    content: { title: "待删课", exercises: [{ name: "卧推", sets: 3, repsText: "10" }] },
  })) as any;
  assert.equal(draft.syncedActions, 2);
  const del1 = (await fitnessService.deletePlan(UA, draft.plan.id)) as any;
  assert.equal(del1.deleted, true);
  const { rows: gone } = await pool.query(`select * from todos where fitness_plan_id = $1`, [draft.plan.id]);
  assert.equal(gone.length, 0, "删除计划应连带清理联动行动");

  // 已打卡计划删除：执行记录保留（plan_id 置空，转独立打卡历史）
  const done = (await fitnessService.savePlanDraft(UA, {
    planDate: today, moduleCode: "run", source: "manual",
    content: { workoutType: "easy", title: "删前打卡跑", segments: [{ label: "主课", distanceM: 5000 }] },
  })) as any;
  await fitnessService.updatePlan(UA, done.plan.id, { status: "done", actual: { distanceM: 5200, durationS: 1800 } });
  await fitnessService.deletePlan(UA, done.plan.id);
  const { rows: keptLog } = await pool.query(`select * from fitness_session_logs where user_id = $1 and log_date = $2`, [UA, today]);
  assert.equal(keptLog.length, 1, "执行记录应保留");
  assert.equal(keptLog[0].plan_id, null, "plan_id 置空转独立历史");
  assert.equal(keptLog[0].actual.distanceM, 5200, "打卡数据不受删除影响");

  // 已删除/不存在 404；非法 id 400；越权 404
  await assert.rejects(() => fitnessService.deletePlan(UA, draft.plan.id), /不存在/);
  await assert.rejects(() => fitnessService.deletePlan(UA, "not-a-uuid"), /id 参数不合法/);
  const mine = (await fitnessService.savePlanDraft(UA, {
    planDate: today, moduleCode: "run", source: "manual",
    content: { workoutType: "easy", title: "越权目标", segments: [] },
  })) as any;
  await assert.rejects(() => fitnessService.deletePlan(UB, mine.plan.id), /不存在/);
  const { rows: still } = await pool.query(`select * from fitness_daily_plans where id = $1`, [mine.plan.id]);
  assert.equal(still.length, 1, "越权删除不得生效");
});

test("A.5 提案工具：只写 chat_proposals；accept → 计划落库+联动；dismiss → 不落库；越权隔离", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  await upsertUser(UB, "fitness冒烟B");
  await cleanup();
  const today = todayStr();
  const tomorrow = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

  const propose = CHAT_PROPOSAL_TOOLS.find((x: any) => x.name === "propose_fitness_plan");
  assert.ok(propose, "propose_fitness_plan 应注册在提案表");

  // 非法日期拒绝（昨天）
  const yesterday = new Date(Date.now() + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  await assert.rejects(() => propose.execute({ userId: UA }, { plan_date: yesterday, module_code: "strength", exercises: [{ name: "卧推" }], rationale: "r" }), /今天|明天/);

  // 缺动作明细拒绝（glm-4-flash 实测会只传 module_code；错误须能回传模型自纠）
  await assert.rejects(
    () => propose.execute({ userId: UA, conversationId: null }, { plan_date: today, module_code: "strength", rationale: "r" }),
    /exercises/,
  );

  const res = (await propose.execute({ userId: UA, conversationId: null }, {
    plan_date: tomorrow,
    module_code: "strength",
    title: "明天力量课 B",
    // reps/weight 简写应归一为 repsText/weightKg
    exercises: [{ name: "坐姿划船", sets: 3, reps: "10-12", weight: 40 }],
    rationale: "明天是轻松跑，按协议正常力量课",
  })) as any;
  assert.equal(res.saved, false, "提案不得直接保存");
  const proposalId = res.proposalId;
  const { rows: propRows } = await pool.query(`select payload from chat_proposals where id = $1`, [proposalId]);
  const ex = propRows[0].payload.content.exercises[0];
  assert.equal(ex.repsText, "10-12", "reps 简写应归一为 repsText");
  assert.equal(ex.weightG, 40000, "weight 简写应归一为 weightG(克)");
  let { rows: plans } = await pool.query(`select * from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, tomorrow]);
  assert.equal(plans.length, 0, "提案后业务表不应有计划");

  // dismiss → 不落库
  await chatService.resolveProposal(UA, proposalId, "dismiss");
  await assert.rejects(() => chatService.resolveProposal(UA, proposalId, "accept"), /已处理/, "已决卡片不可重复处理");
  ({ rows: plans } = await pool.query(`select * from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, tomorrow]));
  assert.equal(plans.length, 0);

  // 再提案 → accept 前端等价流程（先存业务数据再回执）
  const res2 = (await propose.execute({ userId: UA, conversationId: null }, {
    plan_date: tomorrow,
    module_code: "strength",
    title: "明天力量课 B",
    exercises: [{ name: "坐姿划船", sets: 3, repsText: "10-12" }],
    rationale: "重试",
  })) as any;
  const savedPlan = (await fitnessService.savePlanDraft(UA, {
    planDate: tomorrow,
    moduleCode: "strength",
    source: "ai",
    content: res2.payload?.content ?? {
      title: "明天力量课 B",
      exercises: [{ name: "坐姿划船", sets: 3, repsText: "10-12" }],
    },
    rationale: "重试",
  })) as any;
  await chatService.resolveProposal(UA, res2.proposalId, "accept");
  ({ rows: plans } = await pool.query(`select * from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, tomorrow]));
  assert.equal(plans.length, 1, "accept 后计划存在");
  const { rows: linked } = await pool.query(`select * from todos where fitness_plan_id = $1`, [savedPlan.plan.id]);
  assert.equal(linked.length, 2, "accept 联动 1 父 + 1 子");

  // 越权隔离：UB 查不到 UA 的计划与提案处置
  const ubPlans = (await fitnessService.listPlans(UB, today, tomorrow)) as any;
  assert.equal(ubPlans.plans.length, 0);
  await assert.rejects(() => chatService.resolveProposal(UB, res2.proposalId, "dismiss"), /不存在或已处理/);
});

test("目标：每模块一条活跃（重复创建 409）+ 指标 upsert", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  await pool.query(`delete from fitness_goals where user_id = $1`, [UA]);

  const g = (await fitnessService.createGoal(UA, {
    moduleCode: "run",
    title: "珠海半马破 2",
    targetDate: "2026-12-27",
    targets: { finishTimeS: 7200 },
    strategy: { adjustProtocol: [{ when: "质量课当天", action: "上肢轻量" }] },
  })) as any;
  assert.equal(g.goal.status, "active");
  await assert.rejects(
    () => fitnessService.createGoal(UA, { moduleCode: "run", title: "再立一个" }),
    /已有活跃目标/,
    "同模块第二条活跃目标应 409",
  );

  // 身体指标 upsert：同日覆盖
  await fitnessService.saveMetric(UA, { measuredOn: todayStr(), weightKg: 68.4, waistCm: 88 });
  await fitnessService.saveMetric(UA, { measuredOn: todayStr(), weightKg: 68.2, waistCm: 87.5 });
  const metrics = (await fitnessService.listMetrics(UA, todayStr(), todayStr())) as any;
  assert.equal(metrics.metrics.length, 1, "同日 upsert 只留一条");
  assert.equal(metrics.metrics[0].weight_g, 68200);
  assert.equal(metrics.metrics[0].waist_mm, 875);
});

test("REQ-024 睡眠独立记录：manual upsert/同日二写更新/区间过滤/教练工具读 sleep 序列", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "fitness冒烟A");
  await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [UA]);
  const today = todayStr();
  const yesterday = new Date(Date.now() + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10);

  // manual 录入 + 同日二写 = 更新（覆盖打卡迁移值也走同一路径）
  await fitnessService.saveSleep(UA, { date: today, hours: 6.5 });
  await fitnessService.saveSleep(UA, { date: today, hours: 7.2, feeling: "ok", score: 82 });
  await fitnessService.saveSleep(UA, { date: yesterday, hours: 5.8, feeling: "bad" });
  const list = (await fitnessService.listSleep(UA, yesterday, today)) as any;
  assert.equal(list.sleep.length, 2, "两日两条");
  assert.equal(list.sleep[1].hours, 7.2, "同日二写更新");
  assert.equal(list.sleep[1].feeling, "ok", "主观感受落库");
  assert.equal(list.sleep[1].score, 82, "App 睡眠得分落库");
  const { rows: raw } = await pool.query(`select sleep_h_x10, feeling, score, source from fitness_sleep_logs where user_id = $1 and log_date = $2`, [UA, today]);
  assert.equal(raw[0].sleep_h_x10, 72, "小时×10 整数口径");
  assert.equal(raw[0].source, "manual");

  // REQ-025：打卡兼容入参（只带时长）不抹掉已有感受/得分
  await fitnessService.saveSleep(UA, { date: today, hours: 7.0 });
  const preserved = (await fitnessService.listSleep(UA, today, today)) as any;
  assert.equal(preserved.sleep[0].hours, 7.0);
  assert.equal(preserved.sleep[0].feeling, "ok", "时长更新保留 feeling");
  assert.equal(preserved.sleep[0].score, 82, "时长更新保留 score");

  // 打卡兼容入参覆盖同日 manual（checkin 优先级=后写者胜）
  const saved = (await fitnessService.savePlanDraft(UA, {
    planDate: today, moduleCode: "strength", source: "manual",
    content: { title: "课S", exercises: [{ name: "坐姿划船", sets: 2, repsText: "10" }] },
  })) as any;
  await fitnessService.updatePlan(UA, saved.plan.id, { status: "done", actual: { exercises: [{ name: "坐姿划船", sets: 2, repsText: "10" }] }, sleepHours: 8.1 });
  const after = (await fitnessService.listSleep(UA, today, today)) as any;
  assert.equal(after.sleep[0].hours, 8.1, "打卡带睡眠落在独立表");
  const { rows: logRows } = await pool.query(`select sleep_h_x10 from fitness_session_logs where plan_id = $1`, [saved.plan.id]);
  assert.equal(logRows[0].sleep_h_x10, null, "session_logs 不再写睡眠");

  // 教练工具（query_fitness_logs）返回 sleep 序列
  await pool.query(`delete from chat_conversations where user_id = $1`, [UA]);
  const { CHAT_TOOLS } = await import("../src/server/chat/tools");
  const tool = (CHAT_TOOLS as any[]).find((x) => x.name === "query_fitness_logs");
  assert.ok(tool, "工具存在");
  const out = await tool.execute({ userId: UA, conversationId: null }, { from: yesterday, to: today });
  assert.ok(Array.isArray(out.sleep), "返回 sleep 数组");
  assert.equal(out.sleep.length, 2, "区间内两日都返回");
  assert.equal(out.sleep[0].hours, 8.1, "倒序：今日在前");
  assert.ok(out.unitHint.includes("sleep"), "单位提示指向独立记录");

  await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_session_logs where user_id = $1`, [UA]);
});
