/**
 * 训记（SynFit）Open API 集成冒烟（REQ-017）：
 * - 纯函数（无 DB 依赖）：写构造（官方名/计划组 done:false/repsText 上限/计时动作 time/上限拒绝）、
 *   读回映射（done 过滤/聚合/名称反查）、官方名解析器（alias/catalog/兜底）
 * - 客户端（FetchLike stub）：90s 按日读缓存、成功判定 200+res、错误分类（too frequent/apikey）
 * - 真库（SHIGUANGRI_TEST_DB 门禁）：sync 幂等（二次带 localid 更新）、pull 复用打卡状态机、越权/已打卡拒绝
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UA = "22250000-2225-4222-8222-222500001171"; // 训记冒烟用户
const UB = "22250000-2225-4222-8222-222500001172"; // 越权隔离用户

// 纯函数/客户端模块不依赖 DB：进程内先加载（loadConfig 需最小 env）
process.env.XUNJI_API_KEY ??= "xjllm_test_key";
process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

// 纯函数/客户端模块不依赖 DB（CJS 输出不支持顶层 await：模块级 Promise，各 test 内 await）
const modP = import("../src/server/fitness/xunji");

let pool: any;
let fitnessService: any;
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
  if (dbReady) ({ fitnessService } = await import("../src/server/fitness"));
}

const todayStr = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 按 URL 分发的 stub fetcher（catalog / read / upsert 各自的响应与调用记录） */
function stubFetcher(handlers: { catalog?: unknown; read?: unknown; upsert?: unknown }) {
  const calls: { url: string; body: any }[] = [];
  const json = (payload: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  });
  const fetcher = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    if (url.includes("movement_catalog")) return json(handlers.catalog ?? { res: [{ name: "哑铃卧推" }, { name: "哑铃酒杯深蹲" }, { name: "哑铃推肩" }, { name: "坐姿划船" }, { name: "平板支撑" }, { name: "跑步" }] });
    if (url.includes("api_trains_for_llm")) return json(handlers.read ?? { res: [] });
    if (url.includes("api_upsert_trains")) return json(handlers.upsert ?? { res: [] });
    throw new Error(`stub 未覆盖的 URL：${url}`);
  };
  return { fetcher, calls, json };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test("纯函数：repsText 目标解析（上限/秒数）", async () => {
  const { parseRepsTarget, parseSecondsTarget } = (await modP) as any;
  assert.equal(parseRepsTarget("8-12"), 12);
  assert.equal(parseRepsTarget("10/侧"), 10);
  assert.equal(parseRepsTarget("12-15"), 15);
  assert.equal(parseRepsTarget(null), null);
  assert.equal(parseRepsTarget("力竭-2"), 2);
  assert.equal(parseSecondsTarget("30-45s"), 45);
  assert.equal(parseSecondsTarget("45s"), 45);
  assert.equal(parseSecondsTarget("10-12"), null);
});

test("纯函数：动作→训记 movement（官方名/计划组 done:false/重量单位/计时动作）", async () => {
  const { exerciseToMovement } = (await modP) as any;
  const mv = exerciseToMovement({ name: "高脚杯深蹲", sets: 3, repsText: "10-12", weightG: 30000 }, "哑铃酒杯深蹲");
  assert.equal(mv.name, "哑铃酒杯深蹲");
  assert.equal(mv.sets.length, 3);
  assert.deepEqual(mv.sets[0], { done: false, weight: "30", unit: "kg", reps: "12" });

  const plank = exerciseToMovement({ name: "平板支撑", sets: 3, repsText: "30-45s" }, "平板支撑");
  assert.equal(plank.exetype, "record");
  assert.equal(plank.sets[0].time, "45");
  assert.equal(plank.sets[0].reps, undefined);

  // 缺目标（无重量/次数/秒数）拒绝
  assert.throws(() => exerciseToMovement({ name: "深蹲", sets: 3 }, "深蹲"), /缺目标/);
  // 组数越界拒绝（官方上限 20）
  assert.throws(() => exerciseToMovement({ name: "深蹲", sets: 21, repsText: "10" }, "深蹲"), /组数/);
});

test("纯函数：计划→train（力量 15 动作上限/跑步 cardio 有氧日）", async () => {
  const { planToTrain } = (await modP) as any;
  const strength = planToTrain(
    { module_code: "strength", plan_date: todayStr(), content: { title: "课A", exercises: [{ name: "哑铃卧推", sets: 3, repsText: "8-12", weightG: 40000 }] } },
    (n: string) => n,
  );
  assert.equal(strength.movements.length, 1);
  assert.equal(strength.movements[0].sets[0].weight, "40");

  const tooMany = { title: "x", exercises: Array.from({ length: 16 }, (_, i) => ({ name: `动作${i}`, sets: 3, repsText: "10" })) };
  assert.throws(
    () => planToTrain({ module_code: "strength", plan_date: todayStr(), content: tooMany }, (n: string) => n),
    /15/,
  );

  const run = planToTrain(
    { module_code: "run", plan_date: todayStr(), content: { workoutType: "tempo", title: "节奏跑", segments: [{ label: "主课", distanceM: 6000 }], totalDistanceM: 9500, durationMin: 58 } },
    (n: string) => n,
  );
  const cardio = run.movements[0];
  assert.equal(cardio.cardio, true);
  assert.equal(cardio.recordPreset, "running");
  assert.equal(cardio.metrics.distance, "9.5km");
  assert.equal(cardio.metrics.duration, "58min");
  assert.equal(cardio.sets, undefined);
});

test("纯函数：训记读回 → actual（done 过滤/末组重量/名称反查/有氧 metrics）", async () => {
  const { trainsToStrengthActual, trainsToRunActual, makeLocalResolver } = (await modP) as any;
  const trains = [
    {
      movements: [
        {
          name: "哑铃酒杯深蹲",
          sets: [
            { done: true, weight: "32.5", reps: "12" },
            { done: true, weight: "32.5", reps: "10" },
            { done: false, weight: "32.5", reps: "12" },
          ],
        },
        { name: "坐姿划船", sets: [{ done: false, weight: "40", reps: "12" }] },
      ],
    },
  ];
  const r = trainsToStrengthActual(trains, makeLocalResolver());
  assert.equal(r.doneSets, 2);
  assert.equal(r.totalSets, 4);
  assert.equal(r.exercises.length, 1, "未打勾动作不进 actual");
  assert.equal(r.exercises[0].name, "高脚杯深蹲", "官方名反查回拾光名");
  assert.equal(r.exercises[0].sets, 2);
  assert.equal(r.exercises[0].repsText, "12/10");
  assert.equal(r.exercises[0].weightG, 32500);

  const run = trainsToRunActual([{ movements: [{ cardio: true, metrics: { distance: "9.6km", duration: "57min", segments: "热身/主课" } }] }]);
  assert.equal(run.distanceM, 9600);
  assert.equal(run.durationS, 3420);
  assert.equal(run.note, "训记有氧：热身/主课");
});

test("纯函数：官方名解析器（alias 优先/catalog 命中/未匹配拒绝/目录不可用兜底）", async () => {
  const { makeOfficialResolver } = (await modP) as any;
  const catalog = new Set(["哑铃卧推", "哑铃酒杯深蹲", "哑铃推肩", "坐姿划船"]);
  const resolve = makeOfficialResolver(catalog);
  assert.equal(resolve("高脚杯深蹲"), "哑铃酒杯深蹲", "alias 映射到官方名");
  assert.equal(resolve("哑铃卧推"), "哑铃卧推", "同名直用");
  assert.throws(() => resolve("不存在的动作"), /不在训记官方动作库/, "未匹配名拒绝并列名");

  const fallback = makeOfficialResolver(new Set());
  assert.equal(fallback("高脚杯深蹲"), "哑铃酒杯深蹲", "目录不可用时仅信任实测别名");
});

// ---------------------------------------------------------------------------
// 客户端（FetchLike stub）
// ---------------------------------------------------------------------------

test("客户端：按日读缓存 90s——同日两次读只发一次请求", async () => {
  const { readTrains, xunjiCacheInvalidate } = await modP;
  const d = todayStr();
  xunjiCacheInvalidate(d);
  const { fetcher, calls } = stubFetcher({ read: { res: [{ movements: [] }] } });
  const a = await readTrains(d, true, fetcher);
  const b = await readTrains(d, true, fetcher);
  assert.equal(a.length, b.length);
  assert.equal(calls.filter((c) => c.url.includes("api_trains_for_llm")).length, 1, "第二次命中缓存");
});

test("客户端：成功判定 HTTP200+res；upsert 后覆盖当日缓存", async () => {
  const { upsertTrains, readTrains, xunjiCacheInvalidate } = await modP;
  const d = todayStr();
  xunjiCacheInvalidate(d);
  const { fetcher, calls } = stubFetcher({ upsert: { res: [{ localid: "t-1", movements: [] }] } });
  const normalized = await upsertTrains(d, [{ movements: [{ name: "跑步", cardio: true }] }], "req-1", fetcher);
  assert.equal(normalized[0].localid, "t-1");
  assert.equal(calls[0].body.client_request_id, "req-1");

  const cached = await readTrains(d, true, fetcher);
  assert.equal(cached.length, 1, "写后 res 覆盖缓存（读不再发请求）");
  assert.equal(calls.filter((c) => c.url.includes("api_trains_for_llm")).length, 0);
});

test("客户端：错误分类（too frequent 带 retry 提示 / apikey invalid 提示重申请）", async () => {
  const { readTrains, xunjiCacheInvalidate } = await modP;
  xunjiCacheInvalidate(todayStr());
  const errJson = (payload: unknown) => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify(payload),
  });
  const freq = async () => errJson({ error: "too frequent", retry: 37 });
  await assert.rejects(() => readTrains(todayStr(), true, freq as any), /37 秒/);
  const badKey = async () => errJson({ error: "apikey invalid" });
  await assert.rejects(() => readTrains(todayStr(), true, badKey as any), /重新申请/);
});

// ---------------------------------------------------------------------------
// 真库：sync/pull 端点语义（服务层直调 + stub fetcher）
// ---------------------------------------------------------------------------

test("真库：sync 幂等（首建→回写 localid；二次同步带 localid 走更新）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_session_logs where user_id = $1`, [UA]);
  await pool.query(`delete from todos where user_id = $1 and fitness_plan_id is not null`, [UA]);

  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: todayStr(),
    moduleCode: "strength",
    source: "manual",
    content: { title: "课A", exercises: [{ name: "高脚杯深蹲", sets: 3, repsText: "10-12", weightG: 30000 }, { name: "坐姿划船", sets: 3, repsText: "10-12" }] },
  });
  const planId = saved.plan.id;

  // 首次同步：upsert 响应带 localid → 回写 xunji_sync
  let upsertBodies: any[] = [];
  const mk = (localid: string) =>
    stubFetcher({
      upsert: { res: [{ localid, movements: [] }] },
      read: { res: [] },
    });
  const s1 = mk("xj-local-1");
  // 记录 upsert body：包一层
  const s1fetcher = async (url: string, init?: any) => {
    if (url.includes("api_upsert_trains")) upsertBodies.push(JSON.parse(init.body));
    return s1.fetcher(url, init);
  };
  const r1 = await fitnessService.syncPlanToXunji(UA, planId, s1fetcher);
  assert.equal(r1.synced, true);
  assert.equal(r1.updated, false);
  assert.deepEqual(r1.localids, ["xj-local-1"]);
  assert.equal(upsertBodies[0].res[0].localid, undefined, "首建不带 localid");

  // 二次同步：带 localid（更新），响应换新 localid 也照实回写
  const s2 = mk("xj-local-2");
  upsertBodies = [];
  const s2fetcher = async (url: string, init?: any) => {
    if (url.includes("api_upsert_trains")) upsertBodies.push(JSON.parse(init.body));
    return s2.fetcher(url, init);
  };
  const r2 = await fitnessService.syncPlanToXunji(UA, planId, s2fetcher);
  assert.equal(r2.updated, true);
  assert.equal(upsertBodies[0].res[0].localid, "xj-local-1", "更新保留 localid（防重复建）");
  assert.equal(r2.localids[0], "xj-local-2");

  // 计划行上可查到同步状态
  const { rows } = await pool.query(`select xunji_sync->'localids' as ids from fitness_daily_plans where id = $1`, [planId]);
  assert.deepEqual(rows[0].ids, ["xj-local-2"]);
});

test("真库：pull 按训记打勾组自动打卡（日志+行动完成）；已打卡拒绝", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  // 上一条 sync 测试的 upsert 已把「今天」读缓存覆盖为空——官方 90s 缓存语义正确，测试侧先失效
  const { xunjiCacheInvalidate } = await modP;
  xunjiCacheInvalidate(todayStr());

  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: todayStr(),
    moduleCode: "strength",
    source: "manual",
    content: { title: "课B", exercises: [{ name: "哑铃卧推", sets: 3, repsText: "8-12", weightG: 40000 }] },
  });
  const planId = saved.plan.id;
  assert.equal(saved.syncedActions >= 2, true, "父任务+子行动已联动");

  const trains = {
    res: [
      {
        movements: [
          {
            name: "哑铃卧推",
            sets: [
              { done: true, weight: "42.5", reps: "10" },
              { done: true, weight: "42.5", reps: "8" },
              { done: false, weight: "42.5", reps: "10" },
            ],
          },
        ],
      },
    ],
  };
  const preview = await fitnessService.pullXunjiCompletion(UA, planId, { preview: true }, stubFetcher({ read: trains }).fetcher);
  assert.equal(preview.preview, true);
  assert.equal(preview.status, "partial", "2/3 组完成 → partial");
  assert.equal(preview.actual.exercises[0].weightG, 42500);
  const { rows: stillOpen } = await pool.query(`select status from fitness_daily_plans where id = $1`, [planId]);
  assert.equal(stillOpen[0].status, "draft", "preview 不落库");

  const applied = await fitnessService.pullXunjiCompletion(UA, planId, {}, stubFetcher({ read: trains }).fetcher);
  assert.equal(applied.status, "partial");
  const { rows: done } = await pool.query(`select status from fitness_daily_plans where id = $1`, [planId]);
  assert.equal(done[0].status, "partial");
  const { rows: logs } = await pool.query(`select actual->'exercises'->0 as ex0 from fitness_session_logs where plan_id = $1`, [planId]);
  assert.equal(logs[0].ex0.weightG, 42500, "实练重量落日志");
  const { rows: todos } = await pool.query(`select count(*)::int as n from todos where fitness_plan_id = $1 and status = 'done'`, [planId]);
  assert.equal(todos[0].n, 2, "父任务+子行动自动完成");

  await assert.rejects(
    () => fitnessService.pullXunjiCompletion(UA, planId, {}, stubFetcher({ read: trains }).fetcher),
    /已打卡/,
  );
});

test("真库：越权 404；训记里无打勾数据时拒绝", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { xunjiCacheInvalidate } = await modP;
  xunjiCacheInvalidate(todayStr());
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记B') on conflict (id) do update set nickname=excluded.nickname`, [UB]);

  const tomorrow = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: tomorrow,
    moduleCode: "strength",
    source: "manual",
    content: { title: "课C", exercises: [{ name: "坐姿划船", sets: 2, repsText: "12" }] },
  });
  await assert.rejects(() => fitnessService.syncPlanToXunji(UB, saved.plan.id, stubFetcher({}).fetcher), /计划不存在/);
  await assert.rejects(
    () => fitnessService.pullXunjiCompletion(UA, saved.plan.id, {}, stubFetcher({ read: { res: [] } }).fetcher),
    /还没有打勾/,
  );
});
