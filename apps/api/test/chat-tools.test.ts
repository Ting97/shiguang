/**
 * chat 域冒烟（REQ-015 批次 A）：工具注册表 SQL 真实可查 + 越权隔离 + 独立配额口径。
 * 与 admin-data 冒烟同约定：SHIGUANGRI_TEST_DB 不可达整组 skip——
 * 任何工具白名单列名与表结构漂移会在此 42703 暴露（chat 工具 SQL 不走 admin-data 的 DATASETS 白名单）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// 测试用户固定 22250000 前缀（并发 agent 共库隔离约定）
const UA = "22250000-2225-4222-8222-222500001151"; // 有数据用户
const UB = "22250000-2225-4222-8222-222500001152"; // 隔离验证用户（无数据）

let pool: any;
let CHAT_TOOLS: any;
let toAgentTools: any;
let TOOL_LABELS: any;
let getChatQuota: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.chat_conversations') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
  if (dbReady) {
    ({ CHAT_TOOLS, toAgentTools, TOOL_LABELS } = await import("../src/server/chat/tools"));
    ({ getChatQuota } = await import("../src/server/chat/chat-quota"));
  }
}

async function upsertUser(id: string, nickname: string) {
  await pool.query(
    `insert into profiles (id, nickname) values ($1,$2) on conflict (id) do update set nickname = excluded.nickname`,
    [id, nickname],
  );
}

/** 给 UA 造最小数据集：活动 + 时间块 + 流水 + 联系人 + 往来 + 带心情动态 + 负债/交易（含模块授权） */
async function seedData() {
  await pool.query(
    `insert into activities (id, user_id, name) values ('chat-smoke-work', $1, '工作')
     on conflict (id) do update set name = excluded.name`,
    [UA],
  );
  const today = new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
  await pool.query(
    `insert into time_blocks (user_id, activity_id, title, start_at, end_at) values
     ($1, 'chat-smoke-work', '写周报', $2::timestamptz + interval '9 hours', $2::timestamptz + interval '10 hours')`,
    [UA, `${today}T00:00:00Z`],
  );
  await pool.query(
    `insert into transactions (user_id, direction, amount_cents, category, occurred_at, is_draft)
     values ($1, 'out', 12800, '餐饮', now(), false)`,
    [UA],
  );
  const { rows: contact } = await pool.query(
    `insert into contacts (user_id, name, importance) values ($1, '老王', 5)
     on conflict (user_id, name) do update set importance = 5 returning id`,
    [UA],
  );
  await pool.query(
    `insert into interactions (user_id, contact_id, type, summary, occurred_at) values ($1, $2, '见面', '吃饭', now())`,
    [UA, contact[0].id],
  );
  await pool.query(`insert into entries (user_id, source, raw_text, mood, mood_score) values ($1, 'keyboard', '今天很开心', '开心', 60)`, [UA]);
  // 负债/交易模块授权（admin 才直通；测试用户是普通角色必须显式授权）
  await pool.query(
    `insert into user_module_grants (user_id, module) values ($1, 'debt'), ($1, 'trading')
     on conflict (user_id, module) do nothing`,
    [UA],
  );
  await pool.query(
    `insert into liabilities (user_id, name, type, principal_cents, balance_cents, rate_pct, monthly_cents, pay_day)
     values ($1, '测试房贷', 'mortgage', 50000000, 30000000, 4.2, 320000, 15)`,
    [UA],
  );
  const { rows: acct } = await pool.query(
    `insert into trade_accounts (user_id, login, nickname) values ($1, '888', '冒烟户') returning id`,
    [UA],
  );
  await pool.query(
    `insert into trades (user_id, account_id, ticket, symbol, direction, open_time, close_time, lots, profit)
     values ($1, $2, 1001, 'XAUUSD', 'buy', now() - interval '2 days', now() - interval '1 day', 0.1, 120.5)`,
    [UA, acct[0].id],
  );
}

async function runTool(name: string, userId: string, params: Record<string, unknown>) {
  const t = CHAT_TOOLS.find((x: any) => x.name === name);
  return t.execute({ userId }, params);
}

const todayStr = () => new Date(Date.now() - 8 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - 8 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

test("chat 工具注册表：10 工具齐全 + 标签映射对齐", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  assert.equal(CHAT_TOOLS.length, 10);
  for (const tool of CHAT_TOOLS) assert.ok(TOOL_LABELS[tool.name], `${tool.name} 应有中文标签`);
  const agentTools = toAgentTools({ userId: UA });
  assert.equal(agentTools.length, 10, "toAgentTools 应全量映射");
});

test("chat 工具：全工具真实可查（列名漂移在此 42703 暴露）+ 越权隔离", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "chat冒烟A");
  await upsertUser(UB, "chat冒烟B");
  await seedData();

  const from = daysAgo(7);
  const to = todayStr();

  const blocks = (await runTool("query_time_blocks", UA, { from, to })) as any;
  assert.ok(Array.isArray(blocks.byActivity) && blocks.byActivity.length > 0, "UA 时间块应有聚合行");

  const tx = (await runTool("query_transactions", UA, { from, to })) as any;
  assert.equal(tx.totals.find((r: any) => r.direction === "out")?.cents, 12800, "UA 流水汇总应为 12800 分");

  const todos = (await runTool("query_todos", UA, { view: "open", limit: 10 })) as any;
  assert.equal(typeof todos.items.length, "number");

  const contacts = (await runTool("query_contacts", UA, { staleOnly: false, limit: 10 })) as any;
  assert.equal(contacts.items.length, 1, "UA 应有 1 个联系人");

  const inter = (await runTool("query_interactions", UA, { contactName: "老王" })) as any;
  assert.equal(inter.found ?? true, true);
  assert.equal(inter.items.length, 1, "老王应有 1 条往来");

  const mood = (await runTool("query_mood", UA, { days: 7 })) as any;
  assert.equal(mood.items.length, 1, "UA 应有 1 条心情动态");

  const review = (await runTool("get_review", UA, { kind: "day", date: to })) as any;
  assert.equal(review.cached, false, "未生成的复盘应明确无缓存");

  const profile = (await runTool("get_user_profile", UA, {})) as any;
  assert.equal(profile.hasProfile, false, "未生成画像的用户应返回 hasProfile=false");

  // 负债（已授权 + 已种数据）
  const debts = (await runTool("query_debts", UA, {})) as any;
  assert.equal(debts.enabled, true, "已授权用户应可查负债");
  assert.equal(debts.items.length, 1, "UA 应有 1 笔负债");
  assert.equal(debts.totals.balanceCents, 30000000, "负债总余额应为 30000000 分");
  assert.equal(debts.totals.monthlyCents, 320000, "月供合计应为 320000 分");

  // 交易（已授权 + 已种数据）
  const trading = (await runTool("query_trading", UA, {})) as any;
  assert.equal(trading.enabled, true, "已授权用户应可查交易");
  assert.equal(trading.summary.trades, 1, "UA 应有 1 笔平仓");
  assert.ok(Math.abs(trading.summary.net - 120.5) < 0.001, "净利应为 120.5");
  assert.equal(trading.bySymbol[0].symbol, "XAUUSD");

  // 越权隔离：UB 查同样参数应全部为空
  const bBlocks = (await runTool("query_time_blocks", UB, { from, to })) as any;
  assert.equal(bBlocks.byActivity.length, 0, "UB 不得看到 UA 的时间块");
  const bContacts = (await runTool("query_contacts", UB, { staleOnly: false, limit: 10 })) as any;
  assert.equal(bContacts.items.length, 0, "UB 不得看到 UA 的联系人");
  // 模块门禁：UB 未授权 debt/trading → enabled=false 而非数据
  const bDebts = (await runTool("query_debts", UB, {})) as any;
  assert.equal(bDebts.enabled, false, "未授权用户查负债应返回未开通");
  const bTrading = (await runTool("query_trading", UB, {})) as any;
  assert.equal(bTrading.enabled, false, "未授权用户查交易应返回未开通");
});

test("chat 配额：独立按日口径，只数 stage='chat' 的成功调用", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UB, "chat冒烟B");
  const before = await getChatQuota(UB);
  assert.equal(before.plan, "free", "测试用户应为 free");
  // 写两条 chat 审计（一成一败）+ 一条 parse 审计（不得计入 chat 口径）
  for (const [stage, ok] of [["chat", true], ["chat", false], ["parse", true]] as const) {
    await pool.query(
      `insert into audit_logs (user_id, stage, model, ok) values ($1, $2, '', $3)`,
      [UB, stage, ok],
    );
  }
  const after = await getChatQuota(UB);
  assert.equal(after.usedToday, before.usedToday + 1, "只计 ok=true 且 stage='chat'（失败与 parse 不计）");
});
