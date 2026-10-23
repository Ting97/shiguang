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

// 纯函数/客户端模块不依赖 DB：进程内先加载（loadConfig 需最小 env）。
// DATABASE_URL 顶层就指向真库（有 SHIGUANGRI_TEST_DB 时）：本文件顶层 import service 链会
// 构建 pg Pool 且 connectionString 冻结——若先落 placeholder 再由 ensureLoaded 改 env，
// 池已指向占位库（与 ensureLoaded 的模块导入存在竞态，全量套件下稳定落在 placeholder）
process.env.XUNJI_API_KEY ??= "xjllm_test_key";
process.env.EXCHANGE_ENC_KEY ??= "unit-test-enc-key";
process.env.DATABASE_URL ??= process.env.SHIGUANGRI_TEST_DB ?? "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

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
    if (url.includes("movement_catalog")) return json(handlers.catalog ?? { res: [{ name: "哑铃卧推" }, { name: "哑铃酒杯深蹲" }, { name: "哑铃推肩" }, { name: "坐姿划船" }, { name: "平板支撑" }, { name: "跑步（有氧）", type: "有氧" }] });
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
  assert.equal(cardio.name, "跑步", "默认写入名「跑步」");
  assert.equal(cardio.cardio, true);
  assert.equal(cardio.recordPreset, "running");
  assert.equal(cardio.metrics.distance, "9.5km");
  assert.equal(cardio.metrics.duration, "58min");
  assert.equal(cardio.sets, undefined);

  const runOfficial = planToTrain(
    { module_code: "run", plan_date: todayStr(), content: { workoutType: "easy", title: "轻松跑", segments: [], totalDistanceM: 5000 } },
    (n: string) => n,
    "跑步（有氧）",
  );
  assert.equal(runOfficial.movements[0].name, "跑步（有氧）", "v1.1：写入名可对齐目录官方条目");
});

test("纯函数：跑步官方名解析（精确命中/分类优先级/无跑步条目返回 null）", async () => {
  const { resolveRunOfficialName } = (await modP) as any;
  const mv = (name: string, type: string | null) => ({ name, type, exetype: null, aliases: [] });
  assert.equal(resolveRunOfficialName([mv("跑步", null)]), "跑步", "逐字命中直接用");
  assert.equal(
    resolveRunOfficialName([mv("跑步(计时)", "计时动作"), mv("坐姿划船", "背"), mv("跑步（有氧）", "有氧")]),
    "跑步（有氧）",
    "有氧分类优先于计时/其他",
  );
  assert.equal(resolveRunOfficialName([mv("跑步(计时)", "计时动作")]), "跑步(计时)", "仅有计时条目时用计时");
  assert.equal(resolveRunOfficialName([mv("跑步_有氧训练", "热身动作")]), "跑步_有氧训练", "兜底热身分类");
  assert.equal(resolveRunOfficialName([mv("坐姿划船", "背"), mv("跑步机步行", "全身")]), null, "非「跑步」开头不算（跑步机步行属全身）");
  assert.equal(resolveRunOfficialName([mv("坐姿划船", "背")]), null, "无跑步类条目返回 null");
  assert.equal(resolveRunOfficialName([]), null, "目录不可得返回 null");
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
  await assert.rejects(() => readTrains(todayStr(), true, badKey as any), /重新绑定/);
});

test("客户端：每用户 key 读缓存分桶（REQ-042）——同日不同 key 数据隔离", async () => {
  const { readTrains, xunjiCacheInvalidate } = await modP;
  const d = todayStr();
  xunjiCacheInvalidate(d);
  let calls = 0;
  // 按 Authorization 返回该账号自己的数据：keyA 练「卧推」、keyB 练「划船」
  const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls++;
    const bearer = init?.headers?.Authorization ?? "";
    const data = bearer.endsWith("key-A")
      ? [{ movements: [{ name: "哑铃卧推" }] }]
      : [{ movements: [{ name: "坐姿划船" }] }];
    return { ok: true, status: 200, text: async () => JSON.stringify({ res: data }) };
  };
  const a1 = await readTrains(d, true, fetcher as any, "key-A");
  assert.equal(a1[0].movements[0].name, "哑铃卧推");
  const b1 = await readTrains(d, true, fetcher as any, "key-B");
  assert.equal(b1[0].movements[0].name, "坐姿划船", "同日不同 key 各自外呼（不串缓存）");
  const a2 = await readTrains(d, true, fetcher as any, "key-A");
  assert.equal(a2[0].movements[0].name, "哑铃卧推", "keyA 二读仍是自己数据");
  assert.equal(calls, 2, "每 key 各一次外呼，其余命中缓存");
});

// ---------------------------------------------------------------------------
// 真库：sync/pull 端点语义（服务层直调 + stub fetcher）
// ---------------------------------------------------------------------------

/** service 直引（编排/分层加载不进 fitnessService 路由出口；测试库不可达时 DB 层快速失败被降级吸收） */
const svcP = import("../src/server/fitness/service");

/** REQ-022 目录分层缓存会跨用例/跨运行残留（内存 1h + DB 快照 7 天新鲜优先于注入 stub）：
 * 依赖特定目录状态的用例先清内存快照 + 把 DB 行打过期，强制下一次读取走注入的外呼 stub */
async function freshCatalogState() {
  const { resetXunjiCatalogCache } = await svcP;
  resetXunjiCatalogCache();
  if (dbReady) {
    await pool.query(`update fitness_xunji_catalog set fetched_at = now() - interval '8 days' where id = 1`).catch(() => {});
  }
}

/** REQ-042：sync/pull 严格走每用户绑定的 key——真库用例统一先绑定（xunjiKeySave 自带 stub 校验外呼） */
async function bindXunjiKey(user = UA, key = "xjllm_test_key") {
  await fitnessService.xunjiKeySave(user, key, stubFetcher({}).fetcher);
}

test("REQ-042 真库：key 绑定（校验外呼带 Bearer）/脱敏查询/解绑；未绑定 sync/pull 拒绝", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  await pool.query(`delete from user_integration_keys where user_id = $1`, [UA]);

  // 未绑定：savePlanDraft 不受影响（目录走部署级），sync/pull 403 且文案指向配置入口
  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: todayStr(),
    moduleCode: "run",
    source: "manual",
    content: { workoutType: "easy", title: "轻松跑", segments: [{ label: "有氧", distanceM: 3000, paceSPerKm: 400 }] },
  });
  await assert.rejects(() => fitnessService.syncPlanToXunji(UA, saved.plan.id, stubFetcher({}).fetcher), /尚未绑定训记/);
  await assert.rejects(() => fitnessService.pullXunjiCompletion(UA, saved.plan.id, {}, stubFetcher({}).fetcher), /尚未绑定训记/);

  // 绑定：校验外呼带 Bearer <key>；状态脱敏（明文不回显）
  let authHeader = "";
  const fetcher = async (url: string, init?: { headers?: Record<string, string> }) => {
    authHeader = init?.headers?.Authorization ?? "";
    return { ok: true, status: 200, text: async () => JSON.stringify({ res: [] }) };
  };
  const masked = await fitnessService.xunjiKeySave(UA, "xjllm_user_key_9f2", fetcher as any);
  assert.equal(authHeader, "Bearer xjllm_user_key_9f2", "校验外呼携带候选 key");
  assert.equal(masked.apiKeyMasked, "xjl***9f2");
  const info = await fitnessService.xunjiKeyInfo(UA);
  assert.equal(info.bound, true);
  assert.equal(info.apiKeyMasked, "xjl***9f2");
  assert.ok(!JSON.stringify(info).includes("xjllm_user_key_9f2"), "明文 key 不出现在绑定状态里");
  // 绑定后 sync 通过（跑步计划走回退直写路径即可验证不再被 403 拦截）
  await freshCatalogState();
  const synced = await fitnessService.syncPlanToXunji(UA, saved.plan.id, stubFetcher({}).fetcher);
  assert.equal(synced.synced, true);

  // 解绑：状态回落未绑定；再次 sync 回到 403
  await fitnessService.xunjiKeyRemove(UA);
  assert.equal((await fitnessService.xunjiKeyInfo(UA)).bound, false);
  await assert.rejects(() => fitnessService.syncPlanToXunji(UA, saved.plan.id, stubFetcher({}).fetcher), /尚未绑定训记/);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]).catch(() => {});
  await pool.query(`delete from todos where user_id = $1 and fitness_plan_id is not null`, [UA]).catch(() => {});
});

test("真库：sync 幂等（首建→回写 localid；二次同步带 localid 走更新）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await freshCatalogState();
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_session_logs where user_id = $1`, [UA]);
  await pool.query(`delete from todos where user_id = $1 and fitness_plan_id is not null`, [UA]);
  await bindXunjiKey();

  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: todayStr(),
    moduleCode: "strength",
    source: "manual",
    content: { title: "课A", exercises: [{ name: "高脚杯深蹲", sets: 3, repsText: "10-12", weightG: 30000 }, { name: "坐姿划船", sets: 3, repsText: "10-12" }] },
  }, { fetcher: stubFetcher({}).fetcher });
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
  await bindXunjiKey();

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
  await bindXunjiKey();

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

// ---------------------------------------------------------------------------
// REQ-022：动作名对齐训记官方动作库（目录规范化 / 规则通道 / 改名写回 / 匹配编排 / 落库集成）
// ---------------------------------------------------------------------------

test("REQ-022 纯函数：目录规范化（对象行/字符串行/trim/脏行跳过/别名展开）", async () => {
  const { fetchCatalogMovements, catalogToNameSet } = await modP;
  const { fetcher } = stubFetcher({
    catalog: {
      res: {
        movements: [
          { name: "杠铃卧推", type: "胸", exetype: "", aliases: [] },
          "平板支撑",
          { name: "  坐姿划船 ", type: "背", aliases: ["划船"] },
          { name: "", type: "胸" },
          null,
        ],
      },
    },
  });
  const movs = await fetchCatalogMovements(fetcher);
  assert.equal(movs.length, 3, "空名/null 脏行跳过");
  assert.deepEqual(movs[1], { name: "平板支撑", type: null, exetype: null, aliases: [] });
  assert.deepEqual(movs[2], { name: "坐姿划船", type: "背", exetype: null, aliases: ["划船"] });
  const names = catalogToNameSet(movs);
  assert.equal(names.has("杠铃卧推"), true);
  assert.equal(names.has("划船"), true, "别名一并展开");
});

test("REQ-022 纯函数：规则通道（alias 映射/目录精确命中消化/残余进 pending）", async () => {
  const { ruleMatchOfficialNames } = await modP;
  const catalog = new Set(["哑铃酒杯深蹲", "哑铃推肩", "坐姿划船", "划船"]);
  const r = ruleMatchOfficialNames(["高脚杯深蹲", "哑铃肩推", "坐姿划船", "划船", "佳明神秘动作"], catalog);
  assert.equal(r.matched.get("高脚杯深蹲"), "哑铃酒杯深蹲", "实测 alias 命中");
  assert.equal(r.matched.get("哑铃肩推"), "哑铃推肩");
  assert.deepEqual(r.pending, ["佳明神秘动作"], "目录内名字（含别名）不进 pending");
});

// ---------------------------------------------------------------------------
// REQ-023：同步前确认映射（用户确认别名表 / needsConfirmation / skips）
// ---------------------------------------------------------------------------

test("REQ-023 纯函数：splitOfficialNames 分流（用户别名优先/内置别名/精确命中/目录不可得退回）", async () => {
  const { splitOfficialNames } = await modP;
  const catalog = new Set(["坐姿划船", "后倾臀桥"]);
  const userAliases = { 臀桥: "后倾臀桥" };
  const r = splitOfficialNames(["臀桥", "坐姿划船", "高脚杯深蹲", "神秘动作"], catalog, userAliases);
  assert.equal(r.resolved.get("臀桥"), "后倾臀桥", "用户确认别名优先");
  assert.equal(r.resolved.get("坐姿划船"), "坐姿划船", "目录精确命中原样");
  assert.deepEqual(r.unmatched, ["高脚杯深蹲", "神秘动作"], "内置别名目标不在目录内同样 unmatched（宁缺勿错）");

  const empty = splitOfficialNames(["高脚杯深蹲", "臀桥"], new Set(), {});
  assert.equal(empty.resolved.get("高脚杯深蹲"), "哑铃酒杯深蹲", "目录不可得时内置别名仍可用");
  assert.deepEqual(empty.unmatched, ["臀桥"], "目录不可得时目录外名全部 unmatched");
});

test("REQ-023 纯函数：planToTrain 官方名返回 null 跳过该动作", async () => {
  const { planToTrain } = await modP;
  const train = planToTrain(
    {
      module_code: "strength",
      plan_date: todayStr(),
      content: {
        title: "课",
        exercises: [
          { name: "臀桥", sets: 3, repsText: "40s", weightG: 0 },
          { name: "坐姿划船", sets: 3, repsText: "10" },
        ],
      },
    },
    (n: string) => (n === "臀桥" ? null : n),
  );
  assert.equal(train.movements.length, 1, "跳过动作不进 movements");
  assert.equal(train.movements[0].name, "坐姿划船");
});

test("REQ-023 真库：同步遇目录外动作名返回 needsConfirmation → 确认映射落别名表并回写内容 → 再同步自动生效", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await freshCatalogState();
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  await pool.query(`delete from fitness_xunji_aliases where user_id = $1`, [UA]);
  const day = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]);
  await bindXunjiKey();

  // 目录：无光杆「臀桥」「登山者」，有「后倾臀桥」（与线上实际一致的情形）
  const catalog = {
    res: {
      movements: [
        { name: "后倾臀桥", type: "臀部" },
        { name: "杠铃臀桥", type: "臀部" },
        { name: "坐姿划船", type: "背" },
      ],
    },
  };
  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: day,
    moduleCode: "strength",
    source: "import",
    content: {
      title: "循环课",
      exercises: [
        { name: "臀桥", sets: 3, repsText: "40s", weightG: 0 },
        { name: "坐姿划船", sets: 3, repsText: "10-12", weightG: 40000 },
      ],
    },
  }, { fetcher: stubFetcher({ catalog }).fetcher, aiMatch: async () => [] });
  const planId = saved.plan.id;

  // 首次同步（无确认）→ needsConfirmation + 候选
  const first = await fitnessService.syncPlanToXunji(UA, planId, stubFetcher({ catalog }).fetcher);
  assert.equal(first.needsConfirmation, true);
  const bridge = first.unmatched.find((u: any) => u.name === "臀桥");
  assert.ok(bridge, "臀桥进待确认名单");
  assert.ok(bridge.candidates.some((c: any) => c.name === "后倾臀桥"), "候选含目录内臀桥类动作");
  assert.equal(bridge.candidates.some((c: any) => c.name === "臀桥"), false, "无同名项所以臀桥是候选外");
  const { rows: syncNone } = await pool.query(`select xunji_sync from fitness_daily_plans where id = $1`, [planId]);
  assert.equal(syncNone[0].xunji_sync, null, "未确认不同步、不写 localid");

  // 确认映射（臀桥→后倾臀桥）→ 同步成功 + 别名落库 + 计划内容回写佳易名
  let upsertBody: any = null;
  const confirmFetcher = async (url: string, init?: any) => {
    const inner = stubFetcher({ catalog, upsert: { res: [{ localid: "xj-023", movements: [] }] } });
    const r = await inner.fetcher(url, init);
    if (url.includes("api_upsert_trains")) upsertBody = JSON.parse(init.body);
    return r;
  };
  const ok = await fitnessService.syncPlanToXunji(UA, planId, confirmFetcher as any, { mappings: { 臀桥: "后倾臀桥" }, skips: [] });
  assert.equal(ok.synced, true);
  assert.equal(upsertBody.res[0].movements[0].name, "后倾臀桥", "同步载荷用确认后的官方名");
  assert.equal(upsertBody.res[0].movements[1].name, "坐姿划船");
  const { rows: aliasRows } = await pool.query(`select official_name from fitness_xunji_aliases where user_id = $1 and local_name = '臀桥'`, [UA]);
  assert.equal(aliasRows[0]?.official_name, "后倾臀桥", "映射落每用户别名表");
  const { rows: contentRows } = await pool.query(`select content->'exercises'->0 as ex0 from fitness_daily_plans where id = $1`, [planId]);
  assert.equal(contentRows[0].ex0.name, "后倾臀桥", "计划内容回写为官方名");
  assert.equal(contentRows[0].ex0.note, "佳易名：臀桥");

  // 再同步（无确认）：别名表生效，直接成功不再 needsConfirmation
  const again = await fitnessService.syncPlanToXunji(UA, planId, stubFetcher({ catalog, upsert: { res: [{ localid: "xj-023b", movements: [] }] } }).fetcher);
  assert.equal(again.synced, true);
  assert.equal(again.needsConfirmation, undefined);

  // skips：确认时跳过的动作不进同步载荷
  const day2 = new Date(Date.now() + 8 * 3600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
  const saved2 = await fitnessService.savePlanDraft(UA, {
    planDate: day2,
    moduleCode: "strength",
    source: "manual",
    content: {
      title: "课B",
      exercises: [
        { name: "坐姿划船", sets: 2, repsText: "10" },
        { name: "登山者", sets: 3, repsText: "40s", weightG: 0 },
      ],
    },
  }, { fetcher: stubFetcher({ catalog }).fetcher });
  let skipBody: any = null;
  const skipFetcher = async (url: string, init?: any) => {
    const r = await stubFetcher({ catalog, upsert: { res: [{ localid: "xj-023c", movements: [] }] } }).fetcher(url, init);
    if (url.includes("api_upsert_trains")) skipBody = JSON.parse(init.body);
    return r;
  };
  // 登山者无候选前先触发 needsConfirmation，再用 mappings+skips 确认
  const first2 = await fitnessService.syncPlanToXunji(UA, saved2.plan.id, stubFetcher({ catalog }).fetcher);
  assert.equal(first2.needsConfirmation, true);
  assert.ok(first2.unmatched.some((u: any) => u.name === "登山者"));
  const ok2 = await fitnessService.syncPlanToXunji(UA, saved2.plan.id, skipFetcher as any, { mappings: {}, skips: ["登山者"] });
  assert.equal(ok2.synced, true);
  assert.equal(ok2.movements, 1, "跳过动作不进载荷");
  assert.deepEqual(ok2.skipped, ["登山者"]);
  assert.equal(skipBody.res[0].movements.length, 1);

  // 全部跳过 → 400
  await assert.rejects(
    () => fitnessService.syncPlanToXunji(UA, saved2.plan.id, stubFetcher({ catalog }).fetcher, { mappings: {}, skips: ["坐姿划船", "登山者"] }),
    /没有可写入训记的动作/,
  );

  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day2]);
  await pool.query(`delete from fitness_xunji_aliases where user_id = $1`, [UA]);
  await freshCatalogState();
});

test("REQ-022 纯函数：改名写回（name 替换/原名并入 note/未映射原样/超长截断/超长官方名跳过）", async () => {
  const { renameExercisesToOfficial } = await modP;
  const content = {
    title: "课",
    exercises: [
      { name: "坐姿绳索划船", sets: 3, repsText: "10-12", note: "慢放" },
      { name: "卧推", sets: 3, repsText: "10", note: null },
      { name: "保持原样", sets: 2, repsText: "10" },
    ],
  };
  const out = renameExercisesToOfficial(content, new Map([["坐姿绳索划船", "坐姿划船"], ["卧推", "杠铃卧推"]]));
  assert.equal(out.exercises[0].name, "坐姿划船");
  assert.equal(out.exercises[0].note, "佳易名：坐姿绳索划船；慢放", "原名标注在前、原 note 衔后");
  assert.equal(out.exercises[1].name, "杠铃卧推");
  assert.equal(out.exercises[1].note, "佳易名：卧推");
  assert.equal(out.exercises[2].name, "保持原样");
  assert.equal(out.exercises[2].note, undefined);
  assert.equal(content.exercises[0].name, "坐姿绳索划船", "入参不可变");
  const long = renameExercisesToOfficial({ title: "x", exercises: [{ name: "A", note: "长".repeat(80) }] }, new Map([["A", "B"]]));
  assert.ok([...long.exercises[0].note!].length <= 60, "note 60 字上限截断");
  const skip = renameExercisesToOfficial({ title: "x", exercises: [{ name: "A" }] }, new Map([["A", "超".repeat(21)]]));
  assert.equal(skip.exercises[0].name, "A", "官方名超拾光 20 字上限跳过不改");
});

test("REQ-022 编排：分层加载（外呼→内存缓存）；规则通道不耗 AI；AI 结果逐字校验+置信门槛", async () => {
  await ensureLoaded();
  await freshCatalogState();
  const { loadXunjiCatalog, matchXunjiOfficialNames } = await svcP;
  const catalog = {
    res: { movements: [{ name: "坐姿划船", type: "背" }, { name: "哑铃酒杯深蹲", type: "腿" }, { name: "高位下拉", type: "背" }] },
  };
  const { fetcher, calls } = stubFetcher({ catalog });
  const snap = await loadXunjiCatalog(fetcher);
  assert.equal(snap.names.size, 3);
  await loadXunjiCatalog(fetcher);
  assert.equal(calls.filter((c) => c.url.includes("movement_catalog")).length, 1, "内存 1h 缓存命中");

  let aiCalls = 0;
  const aiMatch = async (pending: string[]) => {
    aiCalls += 1;
    assert.deepEqual(pending, ["坐姿绳索划船", "划船机", "反手高位"]);
    return [
      { source: "坐姿绳索划船", official: "坐姿划船", confidence: 0.9 },
      { source: "划船机", official: "编造的动作", confidence: 0.99 },
      { source: "反手高位", official: "高位下拉", confidence: 0.4 },
      { source: "不在输入里", official: "坐姿划船", confidence: 0.9 },
    ];
  };
  const m = await matchXunjiOfficialNames(UA, ["高脚杯深蹲", "坐姿绳索划船", "划船机", "反手高位"], { aiMatch });
  assert.equal(aiCalls, 1);
  assert.equal(m.get("高脚杯深蹲"), "哑铃酒杯深蹲", "alias 走规则通道不耗 AI");
  assert.equal(m.get("坐姿绳索划船"), "坐姿划船");
  assert.equal(m.has("划船机"), false, "目录外官方名（编造）被拦");
  assert.equal(m.has("反手高位"), false, "低置信被拦");
  assert.equal(m.has("不在输入里"), false, "幻觉 source 被拦");

  const m2 = await matchXunjiOfficialNames(UA, ["高脚杯深蹲", "坐姿绳索划船"], {
    aiMatch: async () => {
      throw new Error("glm down");
    },
  });
  assert.equal(m2.get("高脚杯深蹲"), "哑铃酒杯深蹲", "AI 失败降级：规则通道结果保留");
  assert.equal(m2.has("坐姿绳索划船"), false, "AI 失败的待匹配名保留原名");
});

test("REQ-022 编排：外呼失败回退 DB 旧快照；目录完全不可得 → 空集（同步仍走 alias 兜底）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { loadXunjiCatalog, resetXunjiCatalogCache } = await svcP;
  // 先用 stub 外呼写一份新快照进 DB
  await freshCatalogState();
  const good = stubFetcher({ catalog: { res: { movements: [{ name: "坐姿划船", type: "背" }] } } });
  await loadXunjiCatalog(good.fetcher);
  await new Promise((r) => setTimeout(r, 200)); // 写回 fire-and-forget
  // 快照过期 + 外呼失败 → 回退 DB 旧快照（坐姿划船仍在）
  resetXunjiCatalogCache();
  await pool.query(`update fitness_xunji_catalog set fetched_at = now() - interval '8 days' where id = 1`);
  const fail = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: "boom" }) });
  const snap = await loadXunjiCatalog(fail as any);
  assert.equal(snap.names.has("坐姿划船"), true, "外呼失败回退 DB 旧快照");
  resetXunjiCatalogCache();
});

test("REQ-022 真库：savePlanDraft 落库前对齐官方名（note 记佳易名）→ 同步训记不再报「不在官方动作库」", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await freshCatalogState();
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  const day = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]);
  await bindXunjiKey();

  const catalog = { res: { movements: [{ name: "坐姿划船", type: "背" }, { name: "哑铃卧推", type: "胸" }] } };
  const stub = stubFetcher({ catalog });
  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: day,
    moduleCode: "strength",
    source: "import",
    content: {
      title: "佳明力量课",
      exercises: [
        { name: "坐姿绳索划船", sets: 3, repsText: "10-12", weightG: 40000 },
        { name: "哑铃胸部推举", sets: 3, repsText: "10", weightG: 20000 },
      ],
    },
  }, {
    fetcher: stub.fetcher,
    aiMatch: async () => [
      { source: "坐姿绳索划船", official: "坐姿划船", confidence: 0.95 },
      { source: "哑铃胸部推举", official: "哑铃卧推", confidence: 0.85 },
    ],
  });
  const ex = saved.plan.content.exercises;
  assert.equal(ex[0].name, "坐姿划船", "佳明识别名替换为训记官方名");
  assert.equal(ex[0].note, "佳易名：坐姿绳索划船");
  assert.equal(ex[1].name, "哑铃卧推");
  assert.equal(ex[1].note, "佳易名：哑铃胸部推举");

  // 同步训记：动作名全在目录内直接通过；upsert body 里的 movement 名是官方名
  let upsertBody: any = null;
  const syncFetcher = async (url: string, init?: any) => {
    const r = await stubFetcher({ catalog, upsert: { res: [{ localid: "xj-022", movements: [] }] } }).fetcher(url, init);
    if (url.includes("api_upsert_trains")) upsertBody = JSON.parse(init.body);
    return r;
  };
  const synced = await fitnessService.syncPlanToXunji(UA, saved.plan.id, syncFetcher as any);
  assert.equal(synced.synced, true);
  assert.equal(upsertBody.res[0].movements[0].name, "坐姿划船");
  assert.equal(upsertBody.res[0].movements[1].name, "哑铃卧推");
  // 清理：删测试计划；目录缓存不重置（下一用例如需特定目录自行 freshCatalogState）
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]).catch(() => {});
});

// REQ-023 v1.1：实测目录无逐字「跑步」条目（有氧分类下为「跑步（有氧）」），
// 原 run 门禁逐字校验导致所有跑步计划同步必 400——改为写入名自动对齐目录官方条目
test("真库：跑步计划同步——目录无逐字「跑步」自动对齐「跑步（有氧）」；无跑步类条目回退直写+warning", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await freshCatalogState();
  await pool.query(`insert into profiles (id, nickname) values ($1,'训记A') on conflict (id) do update set nickname=excluded.nickname`, [UA]);
  const day = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]);
  await bindXunjiKey();

  const saved = await fitnessService.savePlanDraft(UA, {
    planDate: day,
    moduleCode: "run",
    source: "manual",
    content: { workoutType: "tempo", title: "节奏跑", segments: [{ label: "主课", distanceM: 6000 }], totalDistanceM: 9500, durationMin: 58 },
  }, { fetcher: stubFetcher({ catalog: { res: { movements: [{ name: "坐姿划船", type: "背" }] } } }).fetcher });

  // 目录含「跑步（有氧）」但无逐字「跑步」→ 写入名对齐官方条目，不再 400
  const catalog = { res: { movements: [{ name: "坐姿划船", type: "背" }, { name: "跑步(计时)", type: "计时动作" }, { name: "跑步（有氧）", type: "有氧" }] } };
  let upsertBody: any = null;
  const syncFetcher = async (url: string, init?: any) => {
    const r = await stubFetcher({ catalog, upsert: { res: [{ localid: "xj-run-1", movements: [] }] } }).fetcher(url, init);
    if (url.includes("api_upsert_trains")) upsertBody = JSON.parse(init.body);
    return r;
  };
  const r1 = await fitnessService.syncPlanToXunji(UA, saved.plan.id, syncFetcher as any);
  assert.equal(r1.synced, true);
  assert.equal(upsertBody.res[0].movements[0].name, "跑步（有氧）", "写入名=目录有氧分类官方条目");
  assert.equal(upsertBody.res[0].movements[0].cardio, true);
  assert.equal(r1.warning, undefined);

  // 目录刷新后无任何跑步类条目 → 回退直写「跑步」（017 旧语义）+ warning，不再硬报错
  await freshCatalogState();
  const catalog2 = { res: { movements: [{ name: "坐姿划船", type: "背" }] } };
  let upsertBody2: any = null;
  const syncFetcher2 = async (url: string, init?: any) => {
    const r = await stubFetcher({ catalog: catalog2, upsert: { res: [{ localid: "xj-run-2", movements: [] }] } }).fetcher(url, init);
    if (url.includes("api_upsert_trains")) upsertBody2 = JSON.parse(init.body);
    return r;
  };
  const r2 = await fitnessService.syncPlanToXunji(UA, saved.plan.id, syncFetcher2 as any);
  assert.equal(r2.synced, true, "目录无跑步条目时不再 400");
  assert.equal(upsertBody2.res[0].movements[0].name, "跑步");
  assert.ok(r2.warning, "回退直写带 warning 提示");
  await pool.query(`delete from fitness_daily_plans where user_id = $1 and plan_date = $2`, [UA, day]).catch(() => {});
});
