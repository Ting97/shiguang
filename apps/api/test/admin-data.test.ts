/**
 * R5 后台数据接口冒烟（REQ-005 FR-5.2/5.3/5.5/5.6，5-D 部署前防线）：
 * 核心是「全数据集循环真实查询」——任何 DATASETS 白名单列名与表结构漂移（如 todos.done）
 * 会在此处直接 42703 暴露，防止 P0 复发（个性化注入静默失效）。
 * 与 services-smoke 共用测试库约定（SHIGUANGRI_TEST_DB），不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// 测试用户固定 22250000 前缀（并发 agent 共库隔离约定）
const UA = "22250000-2225-4222-8222-222500000001"; // 有数据用户
const UB = "22250000-2225-4222-8222-222500000002"; // 空数据用户（零变化回归）

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库时不动真实数据库（整组 skip）
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function upsertUser(id: string, nickname: string) {
  await pool.query(
    `insert into profiles (id, nickname, role) values ($1,$2,'admin')
     on conflict (id) do update set nickname = excluded.nickname`,
    [id, nickname],
  );
}

/** 近 30 天窗口（北京日期口径，与服务端装配缺省窗口一致） */
async function last30() {
  const { bjToday, bjAddDays } = await import("@shiguangri/shared/date");
  const to = bjToday();
  return { from: bjAddDays(to, -29), to };
}

test("admin-data：目录完整 + promptRefs 同步（trades→trading_review）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ad = await import("../src/server/ai/admin-data");
  const cat = ad.catalogPayload();
  assert.ok(cat.datasets.length >= 15, "数据集目录应完整");
  const byKey = new Map(cat.datasets.map((d: any) => [d.key, d]));
  // P2 回归：trading_review prompt 消费 trades（buildDigest），promptRefs 必须声明
  assert.deepEqual(byKey.get("trades")?.promptRefs, ["trading_review"], "trades 应含 trading_review");
  assert.ok(byKey.get("todos")?.columns.includes("done_at"), "todos 白名单应含 done_at");
  assert.ok(!byKey.get("todos")?.columns.includes("done"), "todos 白名单不得含不存在的 done 列");
});

test("admin-data：全数据集近 30 天窗口真实可查（P0 冒烟：白名单列全部存在）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ad = await import("../src/server/ai/admin-data");
  await upsertUser(UA, "admin-data冒烟");
  const w = await last30();
  for (const d of ad.catalogPayload().datasets) {
    // 任一白名单列不存在（如曾经的 todos.done）→ PG 42703 在此暴露
    const r = await ad.queryDataset(UA, d.key, { from: w.from, to: w.to, limit: 5 });
    assert.equal(typeof r.total, "number", `${d.key} 应返回 total`);
    assert.ok(Array.isArray(r.items), `${d.key} 应返回 items`);
    const allowed = new Set([d.pkCol ?? "id", ...d.columns]);
    for (const it of r.items) {
      assert.ok(
        Object.keys(it).every((k) => allowed.has(k)),
        `${d.key} 返回列应全部在白名单内：${Object.keys(it).join(",")}`,
      );
    }
  }
  // user_ai_profiles 主键为 user_id 而非 id（pkCol 回归）
  const prof = await ad.queryDataset(UA, "user_ai_profiles", { from: w.from, to: w.to, limit: 5 });
  assert.ok(Array.isArray(prof.items), "user_ai_profiles 应可查（pkCol=user_id）");
});

test("admin-data：入参校验（非法日期 400 / 93 天拒绝 / NaN limit 回落 / offset 钳制）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ad = await import("../src/server/ai/admin-data");
  const { bjToday, bjAddDays } = await import("@shiguangri/shared/date");
  const to = bjToday();

  // 形状合法但日历不存在：应 400（而非 pg cast 500）
  await assert.rejects(
    () => ad.queryDataset(UA, "entries", { from: "2026-13-45", to, limit: 5 }),
    (e: any) => e?.status === 400,
    "2026-13-45 应 400",
  );
  // 92 天 off-by-one：首尾均含时 from=today-92 共 93 天 → 拒绝；-91 共 92 天 → 放行
  await assert.rejects(
    () => ad.queryDataset(UA, "entries", { from: bjAddDays(to, -92), to, limit: 5 }),
    /92/,
    "93 天窗口应拒绝",
  );
  const ok92 = await ad.queryDataset(UA, "entries", { from: bjAddDays(to, -91), to, limit: 5 });
  assert.ok(Array.isArray(ok92.items), "92 天窗口应放行");
  // NaN limit：应回落默认（可执行），而非拼出 limit NaN → 500
  const nan = await ad.queryDataset(UA, "entries", { from: to, to, limit: Number("abc") });
  assert.ok(Array.isArray(nan.items), "NaN limit 应回落默认值");
  // offset 无上限入参：钳制 ≤10000，可执行
  const deep = await ad.queryDataset(UA, "entries", { from: to, to, limit: 5, offset: 1e9 });
  assert.ok(Array.isArray(deep.items), "超大 offset 应钳制后可查");
  // limit 生效
  const lim = await ad.queryDataset(UA, "entries", { from: to, to, limit: 2 });
  assert.ok(lim.items.length <= 2, "limit 应生效");
});

test("admin-data：保存校验服务端硬顶（Σlimit×120 ≤8000，与前端同口径）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ad = await import("../src/server/ai/admin-data");
  assert.throws(
    () => ad.validateUserDataConfig([{ dataset: "entries", limit: 50 }, { dataset: "todos", limit: 50 }]),
    /上限/,
    "估算 12000 > 8000 应拒绝",
  );
  assert.deepEqual(ad.validateUserDataConfig(null), []);
  const ok = ad.validateUserDataConfig([{ dataset: "entries", limit: 50 }]);
  assert.equal(ok[0].limit, 50, "6000 ≤ 8000 应放行");
});

test("admin-data：注入块装配（days 缺省 30 天 + jsonb 渲染 + 空用户零变化）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ad = await import("../src/server/ai/admin-data");
  await upsertUser(UA, "admin-data冒烟");
  // 种子：动态 → 饮食（jsonb items）→ 待办（曾经 done 列崩点）
  await pool.query(`delete from entries where user_id = $1`, [UA]);
  await pool.query(`delete from todos where user_id = $1`, [UA]);
  const { rows } = await pool.query(
    `insert into entries (user_id, source, raw_text, mood) values ($1,'keyboard','冒烟注入午餐动态','满足') returning id`,
    [UA],
  );
  await pool.query(
    `insert into diet_records (user_id, entry_id, meal, items, total_kcal) values ($1,$2,'午餐',$3,350)`,
    [UA, rows[0].id, JSON.stringify([{ name: "米饭", amount: "1 碗", kcal: 200 }])],
  );
  await pool.query(`insert into todos (user_id, title) values ($1,'冒烟注入待办')`, [UA]);

  // jsonb 列应渲染为 JSON 文本而非 "[object Object]"
  const dietBlock = await ad.buildUserDataBlock(UA, [{ dataset: "diet_records", days: 7, limit: 5 }]);
  assert.ok(dietBlock.includes("米饭"), `jsonb 应 stringify 渲染：${dietBlock.slice(0, 120)}`);
  assert.ok(!dietBlock.includes("[object Object]"), "不得出现 [object Object]");

  // days 留空：缺省 30 天窗口装配（而非静默跳过）；todos 查询可执行（P0 回归）
  const todoBlock = await ad.buildUserDataBlock(UA, [{ dataset: "todos", limit: 5 }]);
  assert.ok(todoBlock.includes("近 30 天"), `days 缺省应按 30 天装配：${todoBlock.slice(0, 120)}`);
  assert.ok(todoBlock.includes("冒烟注入待办"), "todos 内容应注入");
  assert.ok(todoBlock.length <= ad.USER_DATA_CAP_DEFAULT, "注入块受硬顶");

  // 空数据用户零变化
  await upsertUser(UB, "admin-data空用户");
  const empty = await ad.buildUserDataBlock(UB, [{ dataset: "entries", days: 7, limit: 5 }]);
  assert.equal(empty, "", "无数据用户注入块为空（零变化）");
});

test("admin-data：audit 记 stage=admin_data 计数（FR-5.5，不记内容）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { writeAuditRecord } = await import("../src/server/ai/audit");
  await writeAuditRecord({
    userId: UA,
    entryId: null,
    stage: "admin_data" as any, // audit.ts 联合类型未含 admin_data；DB 侧 stage 为自由 text
    model: null,
    engine: "admin-data:todos",
    latencyMs: 5,
    textLen: 3, // 只记条数
    ok: true,
  });
  const { rows } = await pool.query(
    `select count(*)::int as n from audit_logs where user_id = $1 and stage = 'admin_data' and text_len = 3`,
    [UA],
  );
  assert.ok(rows[0].n >= 1, "admin_data audit 计数应落库");
});

test("teardown: 清理 admin-data 冒烟数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from audit_logs where user_id = any($1)`, [[UA, UB]]);
  await pool.query(`delete from profiles where id = any($1)`, [[UA, UB]]); // 级联清理 entries/todos/diet_records
  assert.ok(true);
});
