/**
 * Bitget CFD 同步回归（docs/16）：
 * - 签名：固定向量比对 prehash → HMAC-SHA256 → Base64（用 node crypto 独立重算，双实现一致性）
 * - 归组：部分平仓/手续费隔夜费按 orderId+positionId 归属、未匹配计数、direction 反转、开仓价加权
 * - 同步：stub 上游 fetch（不真连）→ importTrades 落库 + 幂等（二次同步全 dup）
 * 同 services-smoke 约定：SHIGUANGRI_TEST_DB 才动库；数据 wx/trade 前缀幂等清理。
 * createSession 不在此链路（不触 cookies()），可全程进程内直调。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const UA = "22290000-1111-4111-8111-111111111111";

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  delete process.env.EXCHANGE_ENC_KEY; // 默认未配置：绑定端点 503 分支可用（getter 实时读，测试中再设）
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.trades') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

test("bitget：签名 prehash 固定向量（HMAC-SHA256 Base64）", async () => {
  await ensureLoaded();
  const { signRequest } = await import("../src/server/finance/trading/bitget-client");
  const cred = { apiKey: "bg_1111", apiSecret: "secret-2222", passphrase: "pass-3333" };
  const ts = "1700000000000";
  const headers = signRequest(cred, "GET", "/api/v3/cfd/account/financial-records", "fromTime=1&limit=500", "", ts);
  // 独立重算 prehash：timestamp + method + path + ?query + body
  const expect = createHmac("sha256", "secret-2222")
    .update(`${ts}GET/api/v3/cfd/account/financial-records?fromTime=1&limit=500`)
    .digest("base64");
  assert.equal(headers["ACCESS-SIGN"], expect);
  assert.equal(headers["ACCESS-TIMESTAMP"], ts);
  assert.equal(headers["ACCESS-KEY"], "bg_1111");
  assert.equal(headers["ACCESS-PASSPHRASE"], "pass-3333");
  // 无 query 时 prehash 不带 "?"
  const h2 = signRequest(cred, "GET", "/api/v3/cfd/trade/current-positions", "", "", ts);
  const expect2 = createHmac("sha256", "secret-2222").update(`${ts}GET/api/v3/cfd/trade/current-positions`).digest("base64");
  assert.equal(h2["ACCESS-SIGN"], expect2);
});

test("bitget：归组——部分平仓归组/费用归属/direction 反转/未匹配计数", async () => {
  await ensureLoaded();
  const { groupBitgetTrades } = await import("../src/server/finance/trading/bitget");
  const orders = [
    { orderId: "O-open-1", symbol: "XAUUSD", side: "buy", status: "filled", avgFillPrice: "2000", quantity: "2", filledQuantity: "2", fillTS: "1700000000000", positionId: "P1" },
    { orderId: "O-open-2", symbol: "XAUUSD", side: "buy", status: "filled", avgFillPrice: "2010", quantity: "1", filledQuantity: "1", fillTS: "1700003600000", positionId: "P1" },
    { orderId: "O-close-1", symbol: "XAUUSD", side: "sell", status: "filled", avgFillPrice: "2050", quantity: "1.5", filledQuantity: "1.5", fillTS: "1700086400000", positionId: "P1" },
  ];
  const records = [
    { id: "R1", orderId: "O-close-1", symbol: "XAUUSD", type: "position_close", amount: "600", ts: "1700086400000" },
    { id: "R2", orderId: "O-close-1", symbol: "XAUUSD", type: "commission", amount: "-3", ts: "1700086400001" },
    { id: "R3", orderId: "O-open-1", symbol: "XAUUSD", type: "commission", amount: "-4", ts: "1700000000001" },
    { id: "R4", orderId: "O-open-2", symbol: "XAUUSD", type: "swap", amount: "-0.5", ts: "1700040000000" },
    { id: "R5", orderId: "O-other", symbol: "XAUUSD", type: "commission", amount: "-9", ts: "1700000000002" },
    { id: "R6", orderId: "", symbol: "", type: "deposit", amount: "10000", ts: "1700000000003" },
  ];
  const g = groupBitgetTrades(records as never[], orders as never[]);
  assert.equal(g.rows.length, 1);
  const row = g.rows[0];
  assert.equal(row.ticket, "O-close-1");
  assert.equal(row.direction, "buy", "平仓单 side=sell → 持仓方向 buy");
  assert.equal(row.openTime, new Date(1700000000000).toISOString(), "openTime 取最早开仓单");
  assert.equal(row.lots, 1.5);
  assert.equal(row.openPrice, 2003.33333, "开仓价按手数加权");
  assert.equal(row.closePrice, 2050);
  assert.equal(row.profit, 600);
  assert.equal(row.commission, -7, "平仓手续费 -3 + 开仓手续费 -4");
  assert.equal(row.swap, -0.5, "同持仓开仓单的隔夜费归属");
  assert.equal(g.unmatchedCommission, 1, "归属不到的手续费计数");
  assert.equal(g.skippedOthers, 1, "出入金跳过");
  // 无平仓单兜底：profit/swap 仍落，direction 兜底 buy、lots 兜底 1
  const g2 = groupBitgetTrades(
    [{ id: "R9", orderId: "O-missing", symbol: "NAS100", type: "position_close", amount: "-120", ts: "1700000000000" }] as never[],
    [],
  );
  assert.equal(g2.rows.length, 1);
  assert.equal(g2.rows[0].direction, "buy");
  assert.equal(g2.rows[0].lots, 1);
  assert.equal(g2.rows[0].profit, -120);
});

test("bitget：同步 stub 上游——落库 + 二次幂等全 dup", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  process.env.EXCHANGE_ENC_KEY = "test-enc-key";
  await pool.query(`insert into profiles (id, nickname) values ($1,'bitget测试') on conflict (id) do nothing`, [UA]);
  const { saveBitgetKeys, syncBitget, getBitgetKeysStatus } = await import("../src/server/finance");
  const infoOk = (url: string) =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(url.includes("account/info") ? JSON.stringify({ code: "00000", data: {} }) : JSON.stringify({ code: "00000", data: [] })) });
  await saveBitgetKeys(UA, { apiKey: "k-2222", apiSecret: "s-2222", passphrase: "p-2222" }, infoOk);
  const status = await getBitgetKeysStatus(UA);
  assert.ok(status.bound && status.apiKeyMasked.includes("***"), "状态只回掩码");

  const body = JSON.stringify({
    code: "00000",
    data: [
      { id: "R1", orderId: "TO-1", symbol: "XAUUSD", type: "position_close", amount: "300", ts: "1700000000000" },
      { id: "R2", orderId: "TO-1", symbol: "XAUUSD", type: "commission", amount: "-2", ts: "1700000000001" },
    ],
  });
  const orderBody = JSON.stringify({
    code: "00000",
    data: [{ orderId: "TO-1", symbol: "XAUUSD", side: "sell", status: "filled", avgFillPrice: "2050", quantity: "1", filledQuantity: "1", fillTS: "1700000000000", positionId: "TP1" }],
  });
  const fetcher = (url: string) =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(url.includes("financial-records") ? body : orderBody) });

  const first = await syncBitget(UA, { from: "2026-01-01", to: "2026-01-31", login: "bitget-t", dryRun: false }, fetcher);
  assert.equal(first.rowsNew, 1, "首同步 1 笔");
  assert.equal(first.rowsDup, 0);
  const second = await syncBitget(UA, { from: "2026-01-01", to: "2026-01-31", login: "bitget-t", dryRun: true }, fetcher);
  assert.equal(second.rowsDup, 1, "二次 dryRun 全 dup（幂等）");
  const { rows } = await pool.query(
    `select t.ticket, t.direction, t.profit, t.commission, t.net_profit, a.source
     from trades t join trade_accounts a on a.id = t.account_id where a.login = 'bitget-t'`,
  );
  assert.equal(rows[0].ticket, "TO-1");
  assert.equal(rows[0].direction, "buy");
  assert.equal(Number(rows[0].profit), 300);
  assert.equal(Number(rows[0].commission), -2);
  assert.equal(Number(rows[0].net_profit), 298, "生成列净额");
  assert.equal(rows[0].source, "bitget", "账户来源 bitget");
  await cleanup();
});

async function cleanup() {
  await pool.query(`delete from trades where user_id = $1`, [UA]);
  await pool.query(`delete from trade_accounts where user_id = $1`, [UA]);
  await pool.query(`delete from user_exchange_keys where user_id = $1`, [UA]);
  await pool.query(`delete from trade_imports where user_id = $1`, [UA]);
  await pool.query(`delete from profiles where id = $1`, [UA]);
}

test("bitget：绑定时即时校验——坏凭据报 Bitget 原因且不落库", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  process.env.EXCHANGE_ENC_KEY = "test-enc-key";
  await pool.query(`insert into profiles (id, nickname) values ($1,'bitget测试') on conflict (id) do nothing`, [UA]);
  const { saveBitgetKeys, getBitgetKeysStatus } = await import("../src/server/finance");
  const errBody = JSON.stringify({ code: "40037", msg: "Apikey 不存在" });
  const errFetcher = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(errBody) });
  await assert.rejects(
    () => saveBitgetKeys(UA, { apiKey: "bad", apiSecret: "bad", passphrase: "bad" }, errFetcher),
    (e: any) => e?.status >= 400 && /40037/.test(e?.message) && /经典模式/.test(e?.message),
    "坏凭据应透出 Bitget 原因与提示",
  );
  const status = await getBitgetKeysStatus(UA);
  assert.equal(status.bound, false, "校验失败的凭据不落库");
  await cleanup();
});
