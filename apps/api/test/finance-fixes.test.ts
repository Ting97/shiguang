/**
 * finance/goal 域修复回归（P0 备付 date 列时区 / P1 还款防重入事务 / P1 dueAt 校验 /
 * P1 trading 日期校验 / P2 counts 先 restore / P2 复盘缓存先于配额 / 500 泄漏收敛）：
 * 进程内直调 service（不依赖 Next 请求作用域），真实 SQL 落测试库；
 * 测试用户 22230000- 前缀避免与其它 agent/冒烟撞车，库不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const U_RESERVE = "22230000-0000-4000-8000-000000000001";
const U_PAY = "22230000-0000-4000-8000-000000000002";
const U_GOAL = "22230000-0000-4000-8000-000000000003";
const U_TRADE = "22230000-0000-4000-8000-000000000004";
const U_COUNTS = "22230000-0000-4000-8000-000000000005";
const U_REVIEW = "22230000-0000-4000-8000-000000000006";
const FX_USERS = [U_RESERVE, U_PAY, U_GOAL, U_TRADE, U_COUNTS, U_REVIEW];

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库时不动真实数据库（整组 skip）
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  delete process.env.ZHIPUAI_API_KEY; // 强制零网络（review 生成链路走 402/503 分支）
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
     on conflict (id) do update set role = 'user'`,
    [id, nickname],
  );
}

/** 北京今天（与 payments 路由同口径），用于 paid_at */
function bjToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

/* ---------- Fix 1：reserve date 列时区（+8h 归一化） ---------- */

test("finance-fix：备付 date 列归一化——当月到期本金计入 + 无月供到期还款自动勾选", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_RESERVE, "fx备付");
  await pool.query(`delete from liabilities where user_id = $1 and name like 'fx备付%'`, [U_RESERVE]);
  await pool.query(`delete from debt_reserve_checks where user_id = $1`, [U_RESERVE]);

  const { reserveOverview, autoCheckAfterPayment, currentMonthFirst } = await import("../src/server/finance");
  const ym = currentMonthFirst().slice(0, 7);
  const ins = await pool.query(
    `insert into liabilities (user_id, name, type, principal_cents, balance_cents, rate_pct, monthly_cents, pay_day, due_date, priority, status)
     values
       ($1,'fx备付银行','mortgage',50000000,30000000,3,50000,9,$2,2,'active'),
       ($1,'fx备付到期','consumer_loan',30000000,30000000,0,null,null,$2,3,'active')
     returning id, name`,
    [U_RESERVE, `${ym}-28`],
  );
  const balloonId = ins.rows.find((r: any) => r.name === "fx备付到期").id;

  // Fix 1a：due_date 是「宿主本地零点」的 Date，必须 +8h 归一化再切日——
  // CST 宿主上旧写法 toISOString 切出前一天 → 当月应还漏计到期本金
  const ov = await reserveOverview(U_RESERVE, ym);
  const bank = ov.items.find((r: any) => r.name === "fx备付银行");
  const balloon = ov.items.find((r: any) => r.name === "fx备付到期");
  assert.ok(bank && balloon, "两行都应出现");
  assert.equal(bank.extra, 30000000, "当月到期本金应计入 extra（date 归一化）");
  assert.equal(bank.need, 30050000, "need = 月供 + 到期本金");
  assert.equal(balloon.pay, 0);
  assert.equal(balloon.need, 30000000, "无月供行 need = 到期本金");

  // Fix 1b：autoCheckAfterPayment 旧写法 String(Date) 得脏串 → extra 恒 0、need=0 直接 return，永不自动勾选
  await autoCheckAfterPayment(U_RESERVE, balloonId, 29999999);
  const ov2 = await reserveOverview(U_RESERVE, ym);
  assert.equal(
    ov2.items.find((r: any) => r.name === "fx备付到期")?.checked,
    false,
    "还款不足到期本金 → 不勾选",
  );
  await autoCheckAfterPayment(U_RESERVE, balloonId, 30000000);
  const ov3 = await reserveOverview(U_RESERVE, ym);
  assert.equal(
    ov3.items.find((r: any) => r.name === "fx备付到期")?.checked,
    true,
    "还款 ≥ 到期本金（need 正确含本金）→ 自动勾选",
  );

  await pool.query(`delete from liabilities where user_id = $1 and name like 'fx备付%'`, [U_RESERVE]);
  await pool.query(`delete from debt_reserve_checks where user_id = $1`, [U_RESERVE]);
});

/* ---------- Fix 2：还款防重检查在事务内 + 行锁 ---------- */

test("finance-fix：并发还款被 for update 串行化——后到者拿锁后防重命中，不重复记账/多扣余额", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_PAY, "fx还款");
  await pool.query(`delete from liabilities where user_id = $1 and name like 'fx还款%'`, [U_PAY]);
  const liab = (
    await pool.query(
      `insert into liabilities (user_id, name, type, principal_cents, balance_cents, rate_pct, monthly_cents, pay_day, due_date, priority, status)
       values ($1,'fx还款信用卡','credit_card',10000000,10000000,18,50000,10,null,1,'active') returning id, balance_cents`,
      [U_PAY],
    )
  ).rows[0];
  const paidAt = bjToday();

  // 复刻 payments 路由修复后的事务模式：begin → select for update → 防重 → insert+扣减 → commit
  const flow = async (client: any) => {
    await client.query("begin");
    const l = (await client.query(`select * from liabilities where id = $1 for update`, [liab.id])).rows[0];
    if (!l || l.status !== "active") {
      await client.query("rollback");
      return "gone";
    }
    const dup = await client.query(
      `select id from liability_payments where liability_id = $1 and paid_at = $2 and amount_cents = $3`,
      [liab.id, paidAt, 50000],
    );
    if (dup.rows[0]) {
      await client.query("rollback");
      return "dup";
    }
    await client.query(
      `insert into liability_payments (user_id, liability_id, amount_cents, paid_at) values ($1,$2,$3,$4)`,
      [U_PAY, liab.id, 50000, paidAt],
    );
    await client.query(`update liabilities set balance_cents = greatest(0, balance_cents - 50000) where id = $1`, [liab.id]);
    await client.query("commit");
    return "ok";
  };

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("set lock_timeout to '5s'");
    await b.query("set lock_timeout to '5s'");
    const pa = flow(a); // A 先拿锁、插入还款（未提交）
    await new Promise((r) => setTimeout(r, 300)); // 等 A 真正持锁
    const pb = flow(b); // B 排队在行锁上，直到 A 提交
    assert.equal(await pa, "ok", "A 正常记账");
    assert.equal(await pb, "dup", "B 拿锁后防重命中 → 409 语义（修复前检查在事务外会双记账）");

    const { rows: pays } = await pool.query(
      `select count(*)::int as n from liability_payments where liability_id = $1`,
      [liab.id],
    );
    assert.equal(pays[0].n, 1, "只落一笔还款");
    const { rows: liabs } = await pool.query(`select balance_cents from liabilities where id = $1`, [liab.id]);
    assert.equal(Number(liabs[0].balance_cents), 10000000 - 50000, "余额只扣一次");
  } finally {
    for (const c of [a, b]) {
      await c.query("rollback").catch(() => {});
      c.release();
    }
    await pool.query(`delete from liabilities where user_id = $1 and name like 'fx还款%'`, [U_PAY]);
  }
});

/* ---------- Fix 3：createTodo/updateTodo 时间入参语义校验 ---------- */

test("goal-fix：dueAt/startAt 非法串 400（不再 Invalid Date 抛 RangeError / 穿透 ::timestamptz 500）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_GOAL, "fx待办");
  const { todoService } = await import("../src/server/goal/service");

  await assert.rejects(
    () => todoService.create(U_GOAL, { title: "fx坏时间", dueAt: "abc" }),
    (e: any) => e?.status === 400 && /dueAt/.test(e.message),
    "create dueAt 非法应 400",
  );
  const { todo } = await todoService.create(U_GOAL, { title: "fx好时间" });
  assert.ok(todo.id, "合法创建不受影响");

  await assert.rejects(
    () => todoService.update(U_GOAL, todo.id, { dueAt: "2025-13-01T09:00" }),
    (e: any) => e?.status === 400 && /dueAt/.test(e.message),
    "PATCH dueAt 形状合法但非真实日期应 400（修复前 PG 500）",
  );
  await assert.rejects(
    () => todoService.update(U_GOAL, todo.id, { startAt: "abc" }),
    (e: any) => e?.status === 400 && /startAt/.test(e.message),
    "PATCH startAt 非法应 400",
  );

  const { todo: patched } = await todoService.update(U_GOAL, todo.id, { dueAt: "2026-10-01T09:00:00+08:00" });
  assert.ok(patched.due_at, "合法 dueAt 更新成功");
  const { todo: cleared } = await todoService.update(U_GOAL, todo.id, { dueAt: null });
  assert.equal(cleared.due_at, null, "dueAt=null 清除时间恒合法");

  await todoService.remove(U_GOAL, todo.id);
});

/* ---------- Fix 4：trading 日期入参接入 isValidCalendarDate ---------- */

test("trading-fix：dailyPnl/listTrades 非真实日历日 400（修复后 ::date cast 抛 500）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_TRADE, "fx交易");
  await pool.query(`delete from trade_accounts where user_id = $1`, [U_TRADE]);
  const f = await import("../src/server/finance");
  await f.importTrades(U_TRADE, {
    dryRun: false,
    login: "fx9002",
    fileName: "fx.xlsx",
    source: "mt5_xlsx",
    rows: [{ ticket: 8801, direction: "buy", openTime: "2026-09-20T03:00:00Z", closeTime: "2026-09-21T04:30:00Z", lots: 1, profit: 50 }],
  });
  const acc = (await f.listAccounts(U_TRADE)).accounts.find((a: any) => a.login === "fx9002");
  assert.ok(acc, "账号应已创建");

  await assert.rejects(
    () => f.dailyPnl(U_TRADE, acc.id, "2024-13-01", "2024-12-31"),
    (e: any) => e?.status === 400,
    "dailyPnl 13 月应 400（修复前 PG 22008 → 500）",
  );
  await assert.rejects(
    () => f.listTrades(U_TRADE, { accountId: acc.id, from: "2024-13-01" }),
    (e: any) => e?.status === 400,
    "listTrades from 13 月应 400",
  );
  await assert.rejects(
    () => f.listTrades(U_TRADE, { accountId: acc.id, to: "2026-02-30" }),
    (e: any) => e?.status === 400,
    "listTrades to 2 月 30 日应 400",
  );

  const daily = await f.dailyPnl(U_TRADE, acc.id, "2026-09-01", "2026-09-30");
  assert.ok(daily.days.some((d: any) => d.ymd === "2026-09-21"), "合法区间照常聚合");
  const list = await f.listTrades(U_TRADE, { accountId: acc.id, from: "2026-09-01", to: "2026-09-30" });
  assert.equal(list.total, 1, "合法区间照常筛选");

  await pool.query(`delete from trade_accounts where user_id = $1`, [U_TRADE]);
});

/* ---------- Fix 5：listTodos 先 restore 再 counts ---------- */

test("goal-fix：日切后首次读取 counts.done 与列表一致（restore 先于 counts）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_COUNTS, "fx计数");
  await pool.query(`delete from todos where user_id = $1`, [U_COUNTS]);
  const { todoService } = await import("../src/server/goal/service");

  const { todo: parent } = await todoService.create(U_COUNTS, { title: "fx父任务" });
  const { todo: action } = await todoService.create(U_COUNTS, {
    title: "fx重复行动",
    parentId: parent.id,
    repeatDaily: true,
  });
  await todoService.update(U_COUNTS, action.id, { done: true });

  const before = await todoService.list(U_COUNTS, "all");
  assert.equal(before.counts.done, 1, "当天完成：done=1（记录日内不恢复）");

  // 模拟跨日：last_done_date 回拨 → 06:00 日切恢复应在本请求内发生
  await pool.query(`update todos set last_done_date = '2020-01-01' where id = $1`, [action.id]);
  const after = await todoService.list(U_COUNTS, "all");
  assert.equal(after.counts.done, 0, "恢复后 counts.done=0（修复前先计数恒 1，与列表矛盾）");
  assert.equal(after.counts.all, 1, "父任务回到待办计数");
  const { rows } = await pool.query(`select status from todos where id = $1`, [action.id]);
  assert.equal(rows[0].status, "pending", "重复行动已惰性恢复为未完成");

  const actions = await todoService.list(U_COUNTS, "today-actions");
  assert.equal(actions.counts.done, 0, "today-actions 视图同样先恢复再计数");

  await pool.query(`delete from todos where user_id = $1`, [U_COUNTS]);
});

/* ---------- Fix 6：复盘缓存命中先于配额门槛 ---------- */

test("trading-fix：额度用尽用户仍可读已有复盘缓存；无/过期缓存才 402", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(U_REVIEW, "fx复盘");
  await pool.query(`delete from trade_accounts where user_id = $1`, [U_REVIEW]);
  await pool.query(`delete from review_caches where user_id = $1`, [U_REVIEW]);
  await pool.query(`delete from audit_logs where user_id = $1`, [U_REVIEW]);
  const accId = (
    await pool.query(`insert into trade_accounts (user_id, login) values ($1,'fx9003') returning id`, [U_REVIEW])
  ).rows[0].id;
  // 免费额度打满（30 天滚动窗口按 audit_logs 计数）
  await pool.query(
    `insert into audit_logs (user_id, stage, model) select $1,'parse','test-model' from generate_series(1,30)`,
    [U_REVIEW],
  );
  const { checkAiQuota } = await import("../src/server/ai");
  assert.equal((await checkAiQuota(U_REVIEW)).allowed, false, "前置：额度已用尽");

  const { generateTradingReview } = await import("../src/server/finance");

  // 无缓存 → 需要真正生成 → 402（门槛仍在）
  await assert.rejects(
    () => generateTradingReview(U_REVIEW, accId, "user", false),
    (e: any) => e?.status === 402,
    "无缓存且额度用尽应 402",
  );

  // 缓存过期（生成后又有新平仓）→ 仍需生成 → 402
  await pool.query(
    `insert into trades (user_id, account_id, ticket, direction, open_time, close_time, lots, profit)
     values ($1,$2,990001,'buy', now() - interval '2 days', now() - interval '1 hour', 1, 10)`,
    [U_REVIEW, accId],
  );
  await pool.query(
    `insert into review_caches (user_id, kind, period_key, review, updated_at)
     values ($1,'trading',$2,$3, now() - interval '1 day')`,
    [U_REVIEW, accId, JSON.stringify({ summary: "过期结论", highlights: [], suggestions: [] })],
  );
  await assert.rejects(
    () => generateTradingReview(U_REVIEW, accId, "user", false),
    (e: any) => e?.status === 402,
    "过期缓存不应直接返回",
  );

  // 缓存新鲜（生成晚于最近平仓）→ 秒回，不再被 402 拦截（修复前配额门槛在缓存读取之前，额度用尽连缓存都拿不到）
  await pool.query(
    `update review_caches set review = $3, updated_at = now()
     where user_id = $1 and kind = 'trading' and period_key = $2`,
    [U_REVIEW, accId, JSON.stringify({ summary: "缓存复盘结论", highlights: [], suggestions: [] })],
  );
  const r = await generateTradingReview(U_REVIEW, accId, "user", false);
  assert.equal(r.cached, true, "命中缓存");
  assert.equal(r.review.summary, "缓存复盘结论", "返回缓存内容");
  assert.ok(r.digest, "缓存命中也带 digest（与生成路径返回体同构）");

  // refresh=true 明确要求重新生成 → 走额度门禁 → 402
  await assert.rejects(
    () => generateTradingReview(U_REVIEW, accId, "user", true),
    (e: any) => e?.status === 402,
    "refresh=true 需重新生成，额度门禁生效",
  );

  await pool.query(`delete from trade_accounts where user_id = $1`, [U_REVIEW]);
  await pool.query(`delete from review_caches where user_id = $1`, [U_REVIEW]);
  await pool.query(`delete from audit_logs where user_id = $1`, [U_REVIEW]);
});

/* ---------- teardown ---------- */

test("teardown: 清理 fx 修复测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from liabilities where user_id = any($1)`, [FX_USERS]);
  await pool.query(`delete from debt_reserve_checks where user_id = any($1)`, [FX_USERS]);
  await pool.query(`delete from todos where user_id = any($1)`, [FX_USERS]);
  await pool.query(`delete from trade_accounts where user_id = any($1)`, [FX_USERS]);
  await pool.query(`delete from review_caches where user_id = any($1)`, [FX_USERS]);
  await pool.query(`delete from audit_logs where user_id = any($1)`, [FX_USERS]);
  assert.ok(true);
});
