/**
 * 内置运动空间（REQ-018）：listSpaces 惰性创建 + 幂等 + 置顶排序；
 * kind='sport' 不可改名/归档/删除（描述可改）；fitness 联动行动挂运动空间；
 * 迁移 056 专项（事务内预置旧「运动」空间含三类数据 → 执行 → 断言迁移与删除 → 重跑幂等 → 回滚）。
 * 与 fitness 冒烟同约定：SHIGUANGRI_TEST_DB 不可达整组 skip；须从 apps/api cwd 跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const UA = "22250000-2225-4222-8222-222500001171"; // sport 主测试用户
const UM = "22250000-2225-4222-8222-222500001172"; // 迁移专项用户

let pool: any;
let spaceService: any;
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
    const { rows } = await pool.query("select to_regclass('public.goal_spaces') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ spaceService } = await import("../src/server/goal"));
    ({ fitnessService } = await import("../src/server/fitness"));
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
  await pool.query(`delete from goal_spaces where user_id = any($1::uuid[])`, [[UA, UM]]);
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
  await pool.query(`delete from fitness_goals where user_id = $1`, [UA]);
  await pool.query(`delete from todos where user_id = any($1::uuid[]) and fitness_plan_id is not null`, [[UA]]);
}

test("listSpaces：惰性创建内置运动空间 + 幂等 + 置顶排序", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "sport冒烟A");
  await cleanup();
  // 先有用户自建空间（active），sport 后到也必须置顶
  await pool.query(
    `insert into goal_spaces (user_id, name, icon, color, status) values ($1, '考研上岸', '📚', '#8b5cf6', 'active')`,
    [UA],
  );

  const first = (await spaceService.list(UA)) as any;
  const sports1 = first.spaces.filter((s: any) => s.kind === "sport");
  assert.equal(sports1.length, 1, "惰性创建恰一个");
  assert.equal(first.spaces[0].kind, "sport", "内置空间排在 active 自建空间之前");
  assert.equal(first.spaces[0].name, "运动");
  assert.equal(first.spaces[0].status, "active");
  assert.ok(first.spaces[1].kind == null, "用户自建空间 kind 为 null");

  const second = (await spaceService.list(UA)) as any;
  assert.equal(second.spaces.filter((s: any) => s.kind === "sport").length, 1, "重复调用不重复创建");
});

test("守卫：内置运动空间不可改名/归档/删除，描述可改", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { rows: sportRows } = await pool.query(
    `select id from goal_spaces where user_id = $1 and kind = 'sport'`,
    [UA],
  );
  const sportId = sportRows[0].id;

  await assert.rejects(() => spaceService.update(UA, sportId, { name: "新名字" }), /不可改名/);
  await assert.rejects(() => spaceService.update(UA, sportId, { status: "archived" }), /不可归档/);
  await assert.rejects(() => spaceService.remove(UA, sportId), /不可删除/);

  const patched = (await spaceService.update(UA, sportId, { description: "训练记录与比赛目标" })) as any;
  assert.equal(patched.space.description, "训练记录与比赛目标");
  const { rows: after } = await pool.query(`select name, status from goal_spaces where id = $1`, [sportId]);
  assert.equal(after[0].name, "运动", "改名被拒后名称不变");
  assert.equal(after[0].status, "active");
});

test("fitness 联动：计划行动挂运动空间 space_id", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "sport冒烟A");
  await pool.query(
    `insert into activities (id, user_id, name) values ('fitness', $1, '健身') on conflict (id, user_id) do nothing`,
    [UA],
  );
  await pool.query(`delete from fitness_daily_plans where user_id = $1`, [UA]);
  await pool.query(`delete from todos where user_id = $1 and fitness_plan_id is not null`, [UA]);

  // 先确保内置空间存在（list 惰性创建），再存计划
  await spaceService.list(UA);
  const saved = (await fitnessService.savePlanDraft(UA, {
    planDate: todayStr(),
    moduleCode: "strength",
    source: "manual",
    content: {
      title: "力量课 B · 拉",
      exercises: [
        { name: "引体向上", sets: 4, repsText: "6-8" },
        { name: "哑铃划船", sets: 3, repsText: "10-12", weightG: 24000 },
      ],
    },
  })) as any;
  assert.ok(saved.syncedActions >= 3, "父任务 + 2 子行动");

  const { rows: sport } = await pool.query(`select id from goal_spaces where user_id = $1 and kind = 'sport'`, [UA]);
  const { rows: linked } = await pool.query(`select space_id from todos where fitness_plan_id = $1`, [saved.plan.id]);
  assert.equal(linked.length, saved.syncedActions);
  for (const row of linked) assert.equal(row.space_id, sport[0].id, "联动任务/行动全部挂运动空间");
});

test("迁移 056 专项：旧「运动」空间三类数据改指内置空间 → 旧空间删除 → 重跑幂等（事务回滚隔离）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UM, "sport迁移用户");

  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations/056-sport-space.sql"),
    "utf8",
  );
  const client = await pool.connect();
  try {
    await client.query("begin");
    // 预置：自建「运动」空间 + 三类数据挂靠
    const { rows: old } = await client.query(
      `insert into goal_spaces (user_id, name, icon, status) values ($1, '运动', '💪', 'active') returning id`,
      [UM],
    );
    const oldId = old[0].id;
    const { rows: todo } = await client.query(
      `insert into todos (user_id, title, kind, space_id) values ($1, '跑半马', 'todo', $2) returning id`,
      [UM, oldId],
    );
    const { rows: entry } = await client.query(
      `insert into entries (user_id, source, raw_text, space_id) values ($1, 'keyboard', '完成首个 10km', $2) returning id`,
      [UM, oldId],
    );
    const { rows: refl } = await client.query(
      `insert into space_reflections (user_id, space_id, content) values ($1, $2, '坚持的力量') returning id`,
      [UM, oldId],
    );

    await client.query(sql); // 第一次执行（多语句 simple query）
    const ns = (await client.query(`select id from goal_spaces where user_id = $1 and kind = 'sport'`, [UM])).rows[0];
    assert.ok(ns, "内置空间已创建");
    let cnt = (await client.query(`select count(*)::int as n from goal_spaces where user_id = $1 and kind = 'sport'`, [UM])).rows[0].n;
    assert.equal(cnt, 1);
    const gone = (await client.query(`select count(*)::int as n from goal_spaces where id = $1`, [oldId])).rows[0].n;
    assert.equal(gone, 0, "旧空间已删除");
    for (const [table, id] of [["todos", todo[0].id], ["entries", entry[0].id], ["space_reflections", refl[0].id]] as const) {
      const r = (await client.query(`select space_id from ${table} where id = $1`, [id])).rows[0];
      assert.equal(r.space_id, ns.id, `${table} 数据已改指内置空间`);
    }

    await client.query(sql); // 第二次执行：幂等
    cnt = (await client.query(`select count(*)::int as n from goal_spaces where user_id = $1 and kind = 'sport'`, [UM])).rows[0].n;
    assert.equal(cnt, 1, "重跑不重复创建");
    const r2 = (await client.query(`select space_id from todos where id = $1`, [todo[0].id])).rows[0];
    assert.equal(r2.space_id, ns.id, "重跑数据不动");
  } finally {
    await client.query("rollback");
    client.release();
  }
  // 回滚后无痕：用户不残留 sport 空间（insert...select from profiles 的全库副作用一并回滚）
  const { rows: leftover } = await pool.query(
    `select count(*)::int as n from goal_spaces where user_id = $1 and kind = 'sport'`,
    [UM],
  );
  assert.equal(leftover[0].n, 0, "事务回滚后无残留");
});
