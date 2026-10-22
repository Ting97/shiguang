/**
 * REQ-038 睡眠自动同步日程回归（真实 SQL 落测试库，服务级直调，零网络）：
 * 1. 保存 8h → 生成跨天同步块（activity='sleep'、sleep_log_id 链接、北京 10-14 23:00 → 10-15 07:00）
 * 2. 同日改 6h 重存 → 仍 1 块且区间更新（替换式幂等）
 * 3. 改 0h 重存 → 同步块删除（0h = 撤销）
 * 4. 预置重叠手动块 → sync.ok=false + 冲突文案、睡眠数据照常落库（先预检再删旧：原同步段不丢）
 * 5. PATCH 同步块改时间 → sleep_log_id 置空解绑；再存生成独立新块（编辑保留、不复活旧链接）
 * 用例 ②–⑤ 依赖 ① 的顺序状态（node:test 文件内顺序执行、全局 --test-concurrency=1）；
 * SHIGUANGRI_TEST_DB 不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// 后缀避开常见取值：并发 agent 共用测试库，22280000- 前缀内互不撞车
const U = "22280000-cafe-4000-8000-00000000cafe";
const D = "2026-10-15"; // log_date（北京）：8h 块应为 10-14 23:00 → 10-15 07:00

let pool: any;
let fitnessService: any;
let timeService: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  delete process.env.ZHIPUAI_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.XUNJI_API_KEY;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.fitness_sleep_logs') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ fitnessService } = await import("../src/server/fitness"));
    timeService = await import("../src/server/time");
  }
}

async function upsertUser() {
  await pool.query(
    `insert into profiles (id, nickname) values ($1,'睡眠同步测试') on conflict (id) do update set nickname = excluded.nickname`,
    [U],
  );
  const { PRESET_ACTIVITIES } = await import("../src/server/time/seed");
  for (const a of PRESET_ACTIVITIES) {
    await pool.query(
      `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
       values ($1,$2,$3,$4,$5,$6,$7,true) on conflict (id, user_id) do nothing`,
      [a.id, U, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
    );
  }
}

/** 用例间清场：派生块 + 睡眠日志（只动本测试用户，不碰共享测试库其他数据） */
async function cleanup() {
  await pool.query(`delete from time_blocks where user_id = $1`, [U]);
  await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [U]);
}

/** 该用户当前同步块（sleep_log_id 非空） */
async function syncedBlocks() {
  const { rows } = await pool.query(
    `select b.*, a.name as activity_name from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
     where b.user_id = $1 and b.sleep_log_id is not null order by b.start_at`,
    [U],
  );
  return rows;
}

/** 北京钟点断言辅助：timestamptz（pg 返回 Date）→ 北京 (月,日,时,分)；UTC getter + 8h，宿主时区无关 */
function bjParts(d: string | Date) {
  const x = new Date((d instanceof Date ? d.getTime() : Date.parse(d)) + 8 * 3600_000);
  return { month: x.getUTCMonth() + 1, day: x.getUTCDate(), hour: x.getUTCHours(), min: x.getUTCMinutes() };
}

test("setup: 测试库可用且用户就绪", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  await upsertUser();
  await cleanup();
});

test("REQ-038① 保存 8h → 跨天同步块 10-14 23:00 → 10-15 07:00（北京）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  const r = await fitnessService.saveSleep(U, { date: D, hours: 8 });
  assert.equal(r.sync.ok, true);
  assert.ok(r.sync.blockId, "应返回同步块 id");
  assert.ok(r.sleep.id, "upsertSleep 应 returning id（链接键）");
  const blocks = await syncedBlocks();
  assert.equal(blocks.length, 1);
  const b = blocks[0];
  assert.equal(b.activity_id, "sleep");
  assert.equal(b.title, "睡眠");
  assert.equal(b.time_mode, "manual");
  assert.equal(b.source, "manual");
  assert.equal(b.sleep_log_id, r.sleep.id);
  assert.deepEqual(bjParts(b.start_at), { month: 10, day: 14, hour: 23, min: 0 });
  assert.deepEqual(bjParts(b.end_at), { month: 10, day: 15, hour: 7, min: 0 });
});

test("REQ-038② 同日改 6h 重存 → 仍 1 块且区间更新（01:00 → 07:00）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  const r = await fitnessService.saveSleep(U, { date: D, hours: 6 });
  assert.equal(r.sync.ok, true);
  const blocks = await syncedBlocks();
  assert.equal(blocks.length, 1, "替换式同步不残留旧块");
  assert.equal(blocks[0].id, r.sync.blockId);
  assert.equal(blocks[0].sleep_log_id, r.sleep.id, "行 id 稳定，链接保持");
  assert.deepEqual(bjParts(blocks[0].start_at), { month: 10, day: 15, hour: 1, min: 0 });
  assert.deepEqual(bjParts(blocks[0].end_at), { month: 10, day: 15, hour: 7, min: 0 });
});

test("REQ-038③ 改 0h 重存 → 同步块删除", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  const r = await fitnessService.saveSleep(U, { date: D, hours: 0 });
  assert.equal(r.sync.ok, true);
  assert.equal(r.sync.blockId, null);
  assert.equal((await syncedBlocks()).length, 0);
  const { rows } = await pool.query(`select sleep_h_x10 from fitness_sleep_logs where user_id = $1 and log_date = $2`, [U, D]);
  assert.equal(rows[0]?.sleep_h_x10, 0, "睡眠数据本身保留");
});

test("REQ-038④ 预置重叠手动块 → sync.ok=false 冲突文案、睡眠照常落库且旧同步段不丢", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  // 先正常同步 8h（块：23:00→07:00），再直接落一个与「改 5h 后新区间（02:00→07:00）」重叠的
  // 手动块（走 SQL 而非 createBlock：应用层重叠预检会拦下与既有同步块重叠的创建，
  // 无法构造出「手动块已占、同步让位」的场景；AI 识别/历史导入等路径确实可能留下这类块）
  await fitnessService.saveSleep(U, { date: D, hours: 8 });
  await pool.query(
    `insert into time_blocks (user_id, activity_id, title, start_at, end_at, time_mode, source)
     values ($1,'work','夜班值守','2026-10-15T02:00:00+08:00','2026-10-15T04:00:00+08:00','manual','manual')`,
    [U],
  );
  const r = await fitnessService.saveSleep(U, { date: D, hours: 5 });
  assert.equal(r.sync.ok, false, "与夜班块重叠应跳过");
  assert.ok(r.sync.reason.includes("一个时刻只能做一件事"), `reason 应为服务端冲突文案，实际：${r.sync.reason}`);
  const { rows } = await pool.query(`select sleep_h_x10 from fitness_sleep_logs where user_id = $1 and log_date = $2`, [U, D]);
  assert.equal(rows[0]?.sleep_h_x10, 50, "冲突时睡眠数据照常保存");
  const blocks = await syncedBlocks();
  assert.equal(blocks.length, 1, "先预检再删旧：原 8h 同步段保留不丢");
  assert.deepEqual(bjParts(blocks[0].start_at), { month: 10, day: 14, hour: 23, min: 0 }, "保留的是旧 8h 区间");
});

test("REQ-038⑤ PATCH 同步块 → sleep_log_id 置空解绑；再存生成独立新块", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  await cleanup(); // ④ 留下的夜班手动块会污染本例区间，先清场
  const saved = await fitnessService.saveSleep(U, { date: D, hours: 8 });
  const blockId = saved.sync.blockId as string;
  // 用户把同步块挪到白天（12:00–20:00，避开夜间）：任何编辑即解绑
  const upd = await timeService.updateBlock(U, blockId, {
    startAt: "2026-10-15T12:00:00+08:00",
    endAt: "2026-10-15T20:00:00+08:00",
  });
  if ("conflict" in upd) throw new Error("白天无冲突，不应返回 conflict");
  const { rows } = await pool.query(`select sleep_log_id from time_blocks where id = $1`, [blockId]);
  assert.equal(rows[0].sleep_log_id, null, "编辑后链接置空");
  // 再存同日睡眠：生成独立新块（编辑过的旧块保留、不被复用/复活）
  const again = await fitnessService.saveSleep(U, { date: D, hours: 8 });
  assert.equal(again.sync.ok, true);
  assert.notEqual(again.sync.blockId, blockId);
  const blocks = await syncedBlocks();
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].id, again.sync.blockId);
  assert.equal(blocks[0].sleep_log_id, again.sleep.id, "新块链接到稳定行 id");
  const all = await pool.query(`select id, sleep_log_id from time_blocks where user_id = $1 order by start_at`, [U]);
  assert.equal(all.rows.length, 2, "编辑块 + 新同步块并存");
  assert.ok(all.rows.some((r: any) => r.id === blockId && r.sleep_log_id === null), "编辑块保留且无链接");
  assert.ok(all.rows.some((r: any) => r.id === again.sync.blockId && r.sleep_log_id !== null), "新块带链接");
});

test("REQ-038⑥ 用户缺「睡眠」分类 → 同步优雅跳过、睡眠照常落库（不炸 fitness 事务）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("SHIGUANGRI_TEST_DB 未配置或不可达");
  // 不播种 activities 的隔离用户：预设缺失属兜底分支（注册即播种 + 预设不可删，正常恒在）
  const U2 = "22280000-cafe-4000-8000-00000000caf2";
  await pool.query(
    `insert into profiles (id, nickname) values ($1,'睡眠同步-无分类') on conflict (id) do update set nickname = excluded.nickname`,
    [U2],
  );
  await pool.query(`delete from time_blocks where user_id = $1`, [U2]);
  await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [U2]);
  try {
    const r = await fitnessService.saveSleep(U2, { date: D, hours: 8 });
    assert.equal(r.sync.ok, false, "缺分类应优雅跳过");
    assert.ok(r.sync.reason.includes("睡眠"), `reason 应可读，实际：${r.sync.reason}`);
    const { rows } = await pool.query(`select sleep_h_x10 from fitness_sleep_logs where user_id = $1 and log_date = $2`, [U2, D]);
    assert.equal(rows[0]?.sleep_h_x10, 80, "睡眠数据照常保存");
    const { rows: tb } = await pool.query(`select id from time_blocks where user_id = $1`, [U2]);
    assert.equal(tb.length, 0, "不产生任何块");
  } finally {
    await pool.query(`delete from time_blocks where user_id = $1`, [U2]);
    await pool.query(`delete from fitness_sleep_logs where user_id = $1`, [U2]);
  }
});
