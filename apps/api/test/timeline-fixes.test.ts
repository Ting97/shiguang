/**
 * timeline 域 P0/P1 修复回归测试（真实 SQL 落测试库，无 KEY 环境走规则兜底，零网络）：
 * 1. confirmPending 事务原子性：中途失败 rollback 保留旧产物（修复前自动提交会静默丢数据）
 * 2. listFeed q+spaceId 同传不再 $4 占位符冲突 500
 * 3. appendManual 北京时区基准日（UTC getter + 8h，宿主时区无关）+ HH:MM 格式校验
 * 4. reRecognize 排除自身旧块（自冲突 409），真冲突仍 409
 * 5. analyzeAndPersist 陈旧文本作废（写库前回读原文）+ 正常路径 analyzed_at 落库
 * 6. patrol 巡检扫描 SQL 参数化可执行（补跑成功打 analyzed_at）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// 后缀刻意避开常见取值：并发 agent 共用测试库，22220000- 前缀内互不撞车
const U1 = "22220000-cafe-4000-8000-00000000cafe"; // 通用用户
const U2 = "22220000-cafe-4000-8000-00000000caf2"; // reRecognize 冲突隔离用户

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库时不动真实数据库（整组 skip）
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  delete process.env.ZHIPUAI_API_KEY; // 强制走规则兜底分支（确定性、零网络）
  delete process.env.TYPESAFE_API_KEY;
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
    `insert into profiles (id, nickname, role) values ($1,$2,'user')
     on conflict (id) do update set nickname = excluded.nickname`,
    [id, nickname],
  );
}

/** 播种预设活动（time_blocks 的 (activity_id, user_id) 复合外键要求同用户行存在） */
async function seedActivities(userId: string) {
  const { PRESET_ACTIVITIES } = await import("../src/server/time/seed");
  for (const a of PRESET_ACTIVITIES) {
    await pool.query(
      `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
       values ($1,$2,$3,$4,$5,$6,$7,true) on conflict (id, user_id) do nothing`,
      [a.id, userId, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
    );
  }
}

async function insertEntry(userId: string, rawText: string, opts: { createdAt?: string } = {}) {
  const { rows } = await pool.query(
    `insert into entries (user_id, source, raw_text, created_at)
     values ($1,'keyboard',$2, coalesce($3::timestamptz, now())) returning id`,
    [userId, rawText, opts.createdAt ?? null],
  );
  return rows[0].id as string;
}

/** 动态删除只把 time_blocks.entry_id 置空不删行：用例收尾按 user 清派生表，避免影响同用户后续用例 */
async function cleanupUserDerived(userId: string) {
  await pool.query(`delete from time_blocks where user_id = $1`, [userId]);
  await pool.query(`delete from todos where user_id = $1`, [userId]);
  await pool.query(`delete from transactions where user_id = $1`, [userId]);
  await pool.query(`delete from interactions where user_id = $1`, [userId]);
  await pool.query(`delete from diet_records where user_id = $1`, [userId]);
  await pool.query(`delete from entry_recognitions where user_id = $1`, [userId]);
}

/* ---------- 修复 1：confirmPending 事务原子性 ---------- */

test("timeline-fix：confirmPending 中途失败 rollback 保留旧块，成功路径 client 事务落库", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U1, "fix测试U1");
  await seedActivities(U1);
  const { confirmPending } = await import("../src/server/timeline");

  const entryId = await insertEntry(U1, "确认流事务测试底稿");
  // 旧块（合法活动 work），作为「已存在的识别产物」
  const oldBlock = (
    await pool.query(
      `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
       values ($1,$2,'work','旧日程块','2026-05-10T01:00:00Z','2026-05-10T02:00:00Z','default','keyboard') returning id`,
      [U1, entryId],
    )
  ).rows[0];

  // 场景 A：新块引用不存在的 activity → insert 中途 FK 失败 → 必须整体回滚（旧块保留、登记仍 pending）
  const badRecId = (
    await pool.query(
      `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
       values ($1,$2,'schedule','pending',$3,0.5,'rules') returning id`,
      [U1, entryId, JSON.stringify({
        startAt: "2026-05-01T01:00:00.000Z", endAt: "2026-05-01T02:00:00.000Z",
        activityId: "no-such-activity-xyz", title: "不该落库",
      })],
    )
  ).rows[0].id as string;
  // 007 起事务内 delete 前有 assertActivityExists 前置校验：脏 activityId 现在抛 400（不再走到 insert 的 FK 500），
  // 但仍在事务内、delete 之前触发——下方回滚断言（旧块保留 / 登记 pending）守护的语义不变
  await assert.rejects(
    () => confirmPending(U1, entryId, "schedule"),
    (e: any) => e?.status === 400 && e?.message === "类别不存在",
    "不存在的活动应前置 400 且事务回滚",
  );
  const kept = await pool.query(`select id from time_blocks where id = $1`, [oldBlock.id]);
  assert.equal(kept.rowCount, 1, "回滚后旧日程块必须还在（修复前 delete 会被自动提交误删）");
  const stillPending = await pool.query(`select status from entry_recognitions where id = $1`, [badRecId]);
  assert.equal(stillPending.rows[0].status, "pending", "回滚后登记仍为 pending（修复前与 delete 状态可能不一致）");

  // 场景 B：合法结果 → 事务内删旧插新 + 登记置 applied
  await pool.query(
    `update entry_recognitions set result = $2 where id = $1`,
    [badRecId, JSON.stringify({
      startAt: "2026-05-01T01:00:00.000Z", endAt: "2026-05-01T02:00:00.000Z",
      activityId: "work", title: "确认落库会议",
    })],
  );
  const ok = await confirmPending(U1, entryId, "schedule");
  assert.ok(ok.ok, "合法确认应成功");
  const blocks = await pool.query(`select id, title from time_blocks where entry_id = $1 and user_id = $2`, [entryId, U1]);
  assert.equal(blocks.rowCount, 1, "确认后该动态应恰好一个新块");
  assert.equal(blocks.rows[0].title, "确认落库会议");
  assert.notEqual(blocks.rows[0].id, oldBlock.id, "旧块应被替换");
  const applied = await pool.query(`select status from entry_recognitions where id = $1`, [badRecId]);
  assert.equal(applied.rows[0].status, "applied", "确认后登记置 applied");

  await pool.query(`delete from entries where id = $1`, [entryId]);
  await cleanupUserDerived(U1);
});

/* ---------- 修复 2：listFeed q + spaceId 同传 ---------- */

test("timeline-fix：listFeed 关键字与空间同时过滤不再 $4 冲突 500", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U1, "fix测试U1");
  const spaceId = crypto.randomUUID();
  await pool.query(
    `insert into goal_spaces (id, user_id, name) values ($1,$2,'fix测试空间') on conflict (id) do nothing`,
    [spaceId, U1],
  );
  const entryId = await insertEntry(U1, "披萨聚餐记录一下");
  await pool.query(`update entries set space_id = $1 where id = $2`, [spaceId, entryId]);
  const otherEntryId = await insertEntry(U1, "披萨但不在空间");

  const { listFeed } = await import("../src/server/timeline");
  // 修复前：q 占用 $4 且 space 也硬编码 $4 → invalid input syntax for type uuid → 500
  const feed = await listFeed(U1, { limit: 10, offset: 0, q: "披萨", spaceId } as any);
  const items = (feed as any).moments ?? [];
  assert.ok(items.some((e: any) => e.id === entryId), "q+spaceId 同传应命中空间内动态");
  assert.ok(!items.some((e: any) => e.id === otherEntryId), "空间外动态不应命中");

  // 回归面：其他三种组合仍正常
  const allFeed = await listFeed(U1, { limit: 10, offset: 0, q: "披萨", spaceId: "all" } as any);
  assert.ok(((allFeed as any).moments ?? []).length >= 2, "q + all 应跨空间命中");
  const noneFeed = await listFeed(U1, { limit: 10, offset: 0, q: "披萨", spaceId: "none" } as any);
  assert.ok(((noneFeed as any).moments ?? []).some((e: any) => e.id === otherEntryId), "q + none 命中未归属动态");
  const onlySpace = await listFeed(U1, { limit: 10, offset: 0, q: "", spaceId } as any);
  assert.ok(((onlySpace as any).moments ?? []).some((e: any) => e.id === entryId), "仅空间过滤应命中");

  await pool.query(`delete from entries where id in ($1,$2)`, [entryId, otherEntryId]);
  await pool.query(`delete from goal_spaces where id = $1`, [spaceId]);
});

/* ---------- 修复 3：appendManual 北京时区 + HH:MM 校验 ---------- */

test("timeline-fix：appendManual 以北京日历日为基准（宿主时区无关）且拒绝非法 HH:MM", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U1, "fix测试U1");
  await seedActivities(U1);
  const { appendManual } = await import("../src/server/timeline");

  // 动态创建于北京 2026-09-24 01:30（UTC 2026-09-23T17:30Z）；补录「09:00-10:00」应落北京 9-24
  const entryId = await insertEntry(U1, "手动补录时区底稿", { createdAt: "2026-09-23T17:30:00Z" });
  const ok = await appendManual(U1, entryId, {
    domain: "schedule",
    payload: { title: "补录日程", startTime: "09:00", endTime: "10:00" },
  });
  assert.ok(ok.ok, "手动补录日程应成功");
  const { rows } = await pool.query(
    `select start_at, end_at from time_blocks where entry_id = $1 and user_id = $2`,
    [entryId, U1],
  );
  assert.equal(rows.length, 1);
  // 北京 2026-09-24 09:00（+08:00）= UTC 2026-09-24T01:00:00Z（断言与宿主时区无关）
  assert.equal(new Date(rows[0].start_at).toISOString(), "2026-09-24T01:00:00.000Z", "开始时间应按北京日历日 +08:00 解析");
  assert.equal(new Date(rows[0].end_at).toISOString(), "2026-09-24T02:00:00.000Z", "结束时间应按北京日历日 +08:00 解析");

  await assert.rejects(
    () => appendManual(U1, entryId, { domain: "schedule", payload: { title: "x", startTime: "9:00", endTime: "10:00" } }),
    /HH:MM/,
    "非 HH:MM 格式应 400 而非 Invalid Date 500",
  );
  await assert.rejects(
    () => appendManual(U1, entryId, { domain: "schedule", payload: { title: "x", startTime: "10:00", endTime: "09:00" } }),
    /晚于/,
    "结束早于开始应 400",
  );

  await pool.query(`delete from entries where id = $1`, [entryId]);
  await cleanupUserDerived(U1);
});

/* ---------- 修复 4：reRecognize 自冲突 409（规则兜底，零网络） ---------- */

test("timeline-fix：reRecognize 排除自身旧块可重识别，他人块真冲突仍 409", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U2, "fix测试U2");
  await seedActivities(U2);
  const { reRecognize } = await import("../src/server/timeline");
  const text = "上午10点到11点开会"; // 规则引擎确定性产出 scheduleApplicable + 显式区间

  const e1 = await insertEntry(U2, text);
  const e2 = await insertEntry(U2, text);

  const r1 = await reRecognize(U2, e1, "schedule");
  assert.ok(r1.applied, "首识应落日程块");
  const blocks1 = await pool.query(`select id from time_blocks where entry_id = $1 and user_id = $2`, [e1, U2]);
  assert.equal(blocks1.rowCount, 1);

  // 修复点：再次重识别不再命中自己的旧块 409，而是替换式更新
  const r2 = await reRecognize(U2, e1, "schedule");
  assert.ok(r2.ok && r2.applied, "同 entry 重识别应成功（自块不算冲突）");
  const blocks2 = await pool.query(`select id from time_blocks where entry_id = $1 and user_id = $2`, [e1, U2]);
  assert.equal(blocks2.rowCount, 1, "替换式：仍恰好一个块");
  assert.notEqual(blocks2.rows[0].id, blocks1.rows[0].id, "旧块已被新块替换");

  // 回归面：另一 entry 同时段识别必须仍报 409 真冲突
  await assert.rejects(
    () => reRecognize(U2, e2, "schedule"),
    (e: any) => e?.status === 409,
    "他人块同时段仍应 409",
  );

  await pool.query(`delete from entries where id in ($1,$2)`, [e1, e2]);
  await cleanupUserDerived(U2);
});

/* ---------- 修复 5（陈旧文本竞态）：analyzeAndPersist 回读原文校验 ---------- */

test("timeline-fix：analyzeAndPersist 文本过期作废不落库，一致时正常打 analyzed_at", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U1, "fix测试U1");
  const { analyzeAndPersist } = await import("../src/server/timeline/analyze");

  const entryId = await insertEntry(U1, "库里的当前原文");
  // 巡检场景：调用方拿的是扫描时旧快照，期间原文已被编辑 → 本次产物必须作废
  await assert.rejects(
    () => analyzeAndPersist(U1, entryId, "调用方手里的旧文本快照"),
    /原文已变更/,
    "旧文本应触发作废保护",
  );
  const stale = await pool.query(`select analyzed_at from entries where id = $1`, [entryId]);
  assert.equal(stale.rows[0].analyzed_at, null, "作废后 analyzed_at 必须留空待巡检补跑");
  const derived = await pool.query(
    `select (select count(*) from transactions where entry_id = $1) as tx,
            (select count(*) from time_blocks where entry_id = $1) as tb`,
    [entryId],
  );
  assert.equal(Number(derived.rows[0].tx), 0, "作废路径不得落任何派生产物");
  assert.equal(Number(derived.rows[0].tb), 0, "作废路径不得落任何派生产物");

  // 原文一致 → 正常识别并打 analyzed_at（规则兜底秒级）
  await analyzeAndPersist(U1, entryId, "库里的当前原文");
  const done = await pool.query(`select analyzed_at from entries where id = $1`, [entryId]);
  assert.ok(done.rows[0].analyzed_at, "一致路径应成功打 analyzed_at");

  await pool.query(`delete from entries where id = $1`, [entryId]);
  await cleanupUserDerived(U1);
});

/* ---------- 修复 6：patrol 扫描 SQL 参数化可执行 ---------- */

test("timeline-fix：patrol 参数化扫描可执行且能补跑超时动态", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U1, "fix测试U1");
  const { retryPendingAnalysis } = await import("../src/server/timeline/patrol");

  const entryId = await insertEntry(U1, "巡检补跑参数化测试句");
  await pool.query(
    `update entries set created_at = now() - interval '30 minutes', analyzed_at = null, analyze_retries = 0 where id = $1`,
    [entryId],
  );

  // 扫描按 created_at 全库取最旧 BATCH 条（并发 agent 共库）：循环至本用例动态被补跑或扫描耗尽
  let done = false;
  for (let i = 0; i < 12 && !done; i++) {
    await retryPendingAnalysis(); // SQL 若未参数化（常量内插）在此直接暴露为执行错误
    const { rows } = await pool.query(`select analyzed_at from entries where id = $1`, [entryId]);
    done = Boolean(rows[0]?.analyzed_at);
    if (!done) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(done, "巡检补跑应为本动态打上 analyzed_at");

  await pool.query(`delete from entries where id = $1`, [entryId]);
  await cleanupUserDerived(U1);
});

/* ---------- teardown：清理本文件测试数据（并发共库只动自己的两个用户） ---------- */

test("teardown: 清理 timeline-fixes 测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanupUserDerived(U1);
  await cleanupUserDerived(U2);
  // profiles 级联清掉剩余 user_id 外键（entries/activities/goal_spaces 等）
  await pool.query(`delete from profiles where id = any($1)`, [[U1, U2]]);
  await pool.query(`delete from audit_logs where user_id = any($1)`, [[U1, U2]]);
  assert.ok(true);
});
