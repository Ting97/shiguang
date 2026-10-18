/**
 * 模块开关三层计算矩阵（REQ-028，迁移 063）：与 fitness/chat-tools 冒烟同约定——
 * SHIGUANGRI_TEST_DB 不可达整组 skip。直测 resolveUserModules（getModuleUser/listUserModules/
 * withModule 门禁均消费它），覆盖：默认兜底/全局关/强制关/强制开/用户自选/父子级联/core 恒开/
 * admin 直通/开关可见性四态/60s 缓存与写路径失效；另做 063 存量搬迁对账。
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const U1 = "33333333-3333-4333-8333-333333333333"; // 普通用户
const U2 = "44444444-4444-4444-8444-444444444444"; // admin

let pool: any;
let resolveUserModules: any;
let invalidateModuleCache: any;
let dbReady = false;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.user_module_prefs') as t");
    dbReady = rows[0].t !== null; // 063 未迁移（旧测试库）整组 skip
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ resolveUserModules, invalidateModuleCache } = await import("../src/server/platform/modules"));
  }
}

async function upsertUser(id: string, nickname: string, role: string) {
  await pool.query(
    `insert into profiles (id, nickname, role) values ($1,$2,$3)
     on conflict (id) do update set role = excluded.role`,
    [id, nickname, role],
  );
}

/** 每用例前清 U1 的三层状态与全局层（module_states 全清，防跨用例污染） */
async function resetState() {
  await pool.query(`delete from user_module_controls where user_id = $1`, [U1]);
  await pool.query(`delete from user_module_prefs where user_id = $1`, [U1]);
  await pool.query(`delete from module_states`);
  invalidateModuleCache();
}

before(async () => {
  await ensureLoaded();
  if (!dbReady) return;
  await upsertUser(U1, "模块矩阵-用户", "user");
  await upsertUser(U2, "模块矩阵-管理员", "admin");
});

beforeEach(async () => {
  if (dbReady) await resetState();
});

after(async () => {
  if (!dbReady) return;
  await resetState();
  await pool.query(`delete from user_module_controls where user_id = $1`, [U1]);
  await pool.query(`delete from user_module_prefs where user_id = $1`, [U1]);
});

const has = async (key: string, user = { id: U1, role: "user" }) =>
  (await resolveUserModules(user)).modules.includes(key);

const prefOf = async (key: string) =>
  (await resolveUserModules({ id: U1, role: "user" })).prefs.find((p: { key: string }) => p.key === key);

test("矩阵①默认兜底：无任何状态时按注册表 defaultOn", async () => {
  if (!dbReady) return;
  assert.equal(await has("people"), true); // defaultOn true
  assert.equal(await has("debt"), false); // defaultOn false（031 授权语义保持）
  assert.equal(await has("timeline"), true); // core
});

test("矩阵②全局关：module_states 覆盖默认（含 admin 配置态）", async () => {
  if (!dbReady) return;
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('people', false, false)`);
  invalidateModuleCache();
  assert.equal(await has("people"), false);
});

test("矩阵③强制关：按用户 controls 优先于自选与默认", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_prefs (user_id, module, enabled) values ($1,'people',true)`,
    [U1],
  );
  await pool.query(
    `insert into user_module_controls (user_id, module, force_state) values ($1,'people','off')`,
    [U1],
  );
  assert.equal(await has("people"), false);
});

test("矩阵④强制开：defaultOn false 的模块可被按用户强制开（031 搬迁语义）", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_controls (user_id, module, force_state) values ($1,'debt','on')`,
    [U1],
  );
  assert.equal(await has("debt"), true);
});

test("矩阵⑤用户自选：prefs 覆盖默认开（关闭保留数据语义）", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_prefs (user_id, module, enabled) values ($1,'people',false)`,
    [U1],
  );
  assert.equal(await has("people"), false);
  const p = await prefOf("people");
  assert.equal(p.value, false);
  assert.equal(p.effective, false);
});

test("矩阵⑥父子级联：父域关子模块一律关，重开父域恢复各自有效态", async () => {
  if (!dbReady) return;
  // fitness 默认开 + 用户保持默认；关 goal → fitness 级联关
  assert.equal(await has("fitness"), true);
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('goal', false, false)`);
  invalidateModuleCache();
  assert.equal(await has("goal"), false);
  assert.equal(await has("fitness"), false); // 级联，即使 fitness 自身无任何关闭状态
  assert.equal(await has("sleep"), false); // 多级级联 goal→fitness→sleep
  // 重开父域：fitness 恢复默认开
  await pool.query(`update module_states set enabled = true where module = 'goal'`);
  invalidateModuleCache();
  assert.equal(await has("fitness"), true);
});

test("矩阵⑦core 恒开：timeline 任何层都关不掉", async () => {
  if (!dbReady) return;
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('timeline', false, false)`);
  await pool.query(
    `insert into user_module_controls (user_id, module, force_state) values ($1,'timeline','off')`,
    [U1],
  );
  await pool.query(
    `insert into user_module_prefs (user_id, module, enabled) values ($1,'timeline',false)`,
    [U1],
  );
  assert.equal(await has("timeline"), true);
});

test("矩阵⑧admin 直通：全量模块 on、不可自选", async () => {
  if (!dbReady) return;
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('finance', false, false)`);
  invalidateModuleCache();
  const r = await resolveUserModules({ id: U2, role: "admin" });
  assert.equal(r.modules.includes("finance"), true);
  assert.equal(r.prefs.every((p: { controllable: boolean }) => !p.controllable), true);
});

test("可见性①：默认 userToggleableDefault（people 可自选 / debt 不可）", async () => {
  if (!dbReady) return;
  assert.equal((await prefOf("people")).controllable, true);
  assert.equal((await prefOf("debt")).controllable, false);
});

test("可见性②：全局 user_toggleable 覆盖注册表默认", async () => {
  if (!dbReady) return;
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('debt', true, true)`);
  invalidateModuleCache();
  assert.equal((await prefOf("debt")).controllable, true);
});

test("可见性③：被强制的模块不可自选（force on/off 均不可拨）", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_controls (user_id, module, force_state) values ($1,'people','on')`,
    [U1],
  );
  assert.equal((await prefOf("people")).controllable, false);
});

test("可见性④：switch_visible 三态覆盖全局 user_toggleable（含强制隐藏）", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_controls (user_id, module, switch_visible) values ($1,'people',false)`,
    [U1],
  );
  assert.equal((await prefOf("people")).controllable, false);
  // 全局禁止自选 + 按用户强制可见 → 可自选
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('people', true, false)`);
  await pool.query(
    `update user_module_controls set switch_visible = true where user_id = $1 and module = 'people'`,
    [U1],
  );
  invalidateModuleCache();
  assert.equal((await prefOf("people")).controllable, true);
});

test("缓存：60s TTL 内不重查，写路径失效后即时生效", async () => {
  if (!dbReady) return;
  assert.equal(await has("people"), true);
  await pool.query(`insert into module_states (module, enabled, user_toggleable) values ('people', false, false)`);
  // 未失效：缓存值仍在（TTL 保护）
  assert.equal(await has("people"), true);
  // 写路径失效：新值即时生效
  invalidateModuleCache();
  assert.equal(await has("people"), false);
  // 单人失效口径：只清目标用户
  await pool.query(`delete from module_states`);
  invalidateModuleCache(U1);
  assert.equal(await has("people"), true);
});

test("063 搬迁对账：controls 强制开行数 ≥ 旧表授权行数（搬迁幂等）", async () => {
  if (!dbReady) return;
  const { rows } = await pool.query(
    `select
       (select count(*) from user_module_grants) as legacy,
       (select count(*) from user_module_controls where force_state = 'on') as forced`,
  );
  const legacy = Number(rows[0].legacy);
  const forced = Number(rows[0].forced);
  // 旧表停写后行数固定；搬迁把每行旧授权变成一条强制开（on conflict do nothing 幂等，只增不减）
  assert.ok(forced >= legacy, `搬迁缺失：legacy=${legacy} forced=${forced}`);
});

test("注册表外 key 一律关（数据残留防御）", async () => {
  if (!dbReady) return;
  await pool.query(
    `insert into user_module_prefs (user_id, module, enabled) values ($1,'ghost_module',true)`,
    [U1],
  );
  const r = await resolveUserModules({ id: U1, role: "user" });
  assert.equal(r.modules.includes("ghost_module"), false);
  // 清理残留行
  await pool.query(`delete from user_module_prefs where user_id = $1 and module = 'ghost_module'`, [U1]);
});
