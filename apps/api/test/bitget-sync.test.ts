/**
 * Bitget CFD 同步回归（docs/16）：
 * - 签名：固定向量比对 prehash → HMAC-SHA256 → Base64（用 node crypto 独立重算，双实现一致性）
 * - fetchCfdRecords：{list,cursor} 嵌套 + cursor 游标 + limit 50 + 页间隔（stub 观察参数）
 * - 归组：一笔平仓一条（direction 反转/fee·swap 拆分/net 恒等）、出入金事件跳过计数
 * - 同步：stub 上游 fetch（不真连）→ importTrades 落库 + 幂等（二次同步全 dup）+ 窗口过滤
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
  const headers = signRequest(cred, "GET", "/api/v3/cfd/account/financial-records", "limit=50", "", ts);
  // 独立重算 prehash：timestamp + method + path + ?query + body
  const expect = createHmac("sha256", "secret-2222")
    .update(`${ts}GET/api/v3/cfd/account/financial-records?limit=50`)
    .digest("base64");
  assert.equal(headers["ACCESS-SIGN"], expect);
  assert.equal(headers["ACCESS-TIMESTAMP"], ts);
  assert.equal(headers["ACCESS-KEY"], "bg_1111");
  assert.equal(headers["ACCESS-PASSPHRASE"], "pass-3333");
  // 无 query 时 prehash 不带 "?"
  const h2 = signRequest(cred, "GET", "/api/v3/account/info", "", "", ts);
  const expect2 = createHmac("sha256", "secret-2222").update(`${ts}GET/api/v3/account/info`).digest("base64");
  assert.equal(h2["ACCESS-SIGN"], expect2);
});

test("bitget：fetchCfdRecords——{list,cursor} 嵌套翻页 + limit 50（stub 观察参数）", async () => {
  await ensureLoaded();
  const { fetchCfdRecords } = await import("../src/server/finance/trading/bitget-client");
  const cred = { apiKey: "k", apiSecret: "s", passphrase: "p" };
  const seen: string[] = [];
  const pageOf = (n: number, next: string | null) =>
    JSON.stringify({ code: "00000", data: { list: Array.from({ length: n }, (_, i) => ({ id: String(i) })), cursor: next } });
  // 3 页：50+50+30（短页终止）；每次返回独立 cursor
  const fetcher = (url: string) => {
    seen.push(url);
    const call = seen.length;
    const body = call === 1 ? pageOf(50, "c1") : call === 2 ? pageOf(50, "c2") : pageOf(30, null);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  };
  const out = await fetchCfdRecords(cred, { fetcher });
  assert.equal(out.length, 130, "三页累加");
  assert.equal(seen.length, 3);
  const u1 = new URL(seen[0]);
  const u2 = new URL(seen[1]);
  const u3 = new URL(seen[2]);
  assert.equal(u1.pathname, "/api/v3/cfd/account/financial-records");
  assert.equal(u1.searchParams.get("limit"), "50");
  assert.equal(u1.searchParams.get("cursor"), null, "首页无游标");
  assert.equal(u2.searchParams.get("cursor"), "c1", "游标透传推进");
  assert.equal(u3.searchParams.get("cursor"), "c2");
  // 空首页一页即停
  seen.length = 0;
  const empty = JSON.stringify({ code: "00000", data: { list: [], cursor: null } });
  await fetchCfdRecords(cred, { fetcher: (url) => { seen.push(url); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(empty) }); } });
  assert.equal(seen.length, 1);
});

const WIN_OPEN = 1_767_225_600_000; // 2026-01-01（窗口外旧数据）
const WIN_TS = 1_790_000_000_000; // 2026-09-21 前后（同步窗口 2026-09-01~09-30 内）

test("bitget：CFD 归组——开仓/平仓行区分/LIFO 配对开仓时间/费用归属/出入金跳过", async () => {
  await ensureLoaded();
  const { groupCfdRecords } = await import("../src/server/finance/trading/bitget");
  const g = groupCfdRecords([
    // 出入金事件（symbol 空）与缺 orderId 的行：跳过计数
    { id: "R0", ts: String(WIN_TS - 1), symbol: "", side: "", qty: "0", cashFlow: "-1749.08", orderId: "0" },
    // 开仓行：closePrice=0 & cashFlow=0 & openPrice>0，fee=开仓手续费（不生成 trade，入栈待配对）
    { id: "R1", ts: String(WIN_TS), symbol: "XAUUSD", side: "buy", qty: "0.08", swap: "0", fee: "-0.43", cashFlow: "0", openPrice: "4160.99", closePrice: "0", orderId: "22675681" },
    // 对应平仓行（平仓动作 sell）：openTime 配对开仓行、开仓费归入 commission、行内自带开仓均价
    { id: "R2", ts: String(WIN_TS + 60_000), symbol: "XAUUSD", side: "sell", qty: "0.08", swap: "0", fee: "-0.44", cashFlow: "1.44", openPrice: "4160.99", closePrice: "4161.17", orderId: "22675709" },
    // 带隔夜费平仓（无配对开仓行）：profit=cashFlow-fee-swap、swap 透传
    { id: "R3", ts: String(WIN_TS + 2), symbol: "XAUUSD", side: "buy", qty: "1", swap: "-0.5", fee: "-2", cashFlow: "-40.14", openPrice: "4200", closePrice: "4160", orderId: "22676000" },
    // 缺 orderId 的带 symbol 行：跳过
    { id: "R4", ts: String(WIN_TS + 3), symbol: "XAUUSD", cashFlow: "1", orderId: "" },
  ]);
  assert.equal(g.rows.length, 2, "开仓行不生成 trade");
  assert.equal(g.skippedEvents, 2, "出入金/缺 orderId 事件不落数");
  assert.equal(g.openRowsUnmatched, 0, "R1 被 R2 消费");

  const a = g.rows.find((r) => r.ticket === "C22675709")!;
  const b = g.rows.find((r) => r.ticket === "C22676000")!;
  assert.ok(a && b);
  assert.equal(a.direction, "buy", "平仓动作 sell → 持仓方向 buy");
  assert.equal(a.lots, 0.08);
  assert.equal(a.openPrice, 4160.99, "行内自带开仓均价优先");
  assert.equal(a.closePrice, 4161.17);
  assert.equal(a.openTime, new Date(WIN_TS).toISOString(), "开仓时间取配对开仓行 ts");
  assert.equal(a.closeTime, new Date(WIN_TS + 60_000).toISOString());
  assert.equal(a.profit, 1.88, "毛利 = cashFlow - fee平 - swap平（fee 为负，加回）");
  assert.equal(a.commission, -0.87, "开仓费 -0.43 + 平仓费 -0.44");
  assert.equal(a.swap, 0);
  assert.ok(Math.abs(a.profit + a.commission + a.swap - 1.01) < 1e-9, "净额 = cashFlow + 开仓费（该笔交易总资金影响）");

  assert.equal(b.ticket, "C22676000");
  assert.equal(b.direction, "sell", "平仓动作 buy → 持仓方向 sell");
  assert.equal(b.openTime, b.closeTime, "无配对开仓行兜底=平仓时间");
  assert.equal(b.profit, -37.64, "毛利 = cashFlow - fee - swap（支出为负，加回费用）");
  assert.equal(b.commission, -2);
  assert.equal(b.swap, -0.5);
  // 恒等式：net_profit 生成列 = profit + commission + swap = cashFlow
  assert.ok(Math.abs(b.profit + b.commission + b.swap - (-40.14)) < 1e-9);

  // 倒序输入（上游翻页新→旧）同样正确配对：openTime 必须早于 closeTime
  const g2 = groupCfdRecords([
    { id: "X2", ts: String(WIN_TS + 60_000), symbol: "BTCUSD", side: "sell", qty: "1", cashFlow: "5", openPrice: "100", closePrice: "105", orderId: "9002" },
    { id: "X1", ts: String(WIN_TS), symbol: "BTCUSD", side: "buy", qty: "1", fee: "-0.2", cashFlow: "0", openPrice: "100", closePrice: "0", orderId: "9001" },
  ]);
  assert.equal(g2.rows.length, 1);
  assert.equal(g2.rows[0].openTime, new Date(WIN_TS).toISOString(), "倒序输入先正序化再配对");
  assert.ok(g2.rows[0].openTime < g2.rows[0].closeTime, "持仓时长为正");
  assert.equal(g2.rows[0].commission, -0.2, "开仓费归属");
});

test("bitget：同步 stub 上游——窗口过滤 + 落库 + 二次幂等全 dup", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  process.env.EXCHANGE_ENC_KEY = "test-enc-key";
  await pool.query(`insert into profiles (id, nickname) values ($1,'bitget测试') on conflict (id) do nothing`, [UA]);
  const { saveBitgetKeys, syncBitget, getBitgetKeysStatus } = await import("../src/server/finance");
  const ok = (data: unknown) => JSON.stringify({ code: "00000", data });
  const page1 = { list: [
    { id: "R0", ts: String(WIN_OPEN), symbol: "XAUUSD", side: "sell", qty: "1", cashFlow: "10", openPrice: "4000", closePrice: "4010", orderId: "OLD1" },
    { id: "R5", ts: String(WIN_TS - 60_000), symbol: "XAUUSD", side: "buy", qty: "0.08", fee: "-0.43", cashFlow: "0", openPrice: "4160.99", closePrice: "0", orderId: "22675681" },
    { id: "R1", ts: String(WIN_TS), symbol: "XAUUSD", side: "sell", qty: "0.08", cashFlow: "1.44", openPrice: "4160.99", closePrice: "4161.17", orderId: "22675709" },
    { id: "R2", ts: String(WIN_TS + 1), symbol: "", cashFlow: "-1749.08", orderId: "0" },
  ], cursor: null };
  const fetcher = (url: string) => {
    if (url.includes("/api/v3/account/info")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok({})) });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok(page1)) });
  };
  await saveBitgetKeys(UA, { apiKey: "k-2222", apiSecret: "s-2222", passphrase: "p-2222" }, fetcher);
  const status = await getBitgetKeysStatus(UA);
  assert.ok(status.bound && status.keys[0].apiKeyMasked.includes("***"), "状态逐把回掩码");

  const first = await syncBitget(UA, { from: "2026-09-01", to: "2026-09-30", keyLabel: "默认", login: "bitget-t", dryRun: false }, fetcher);
  assert.equal(first.rowsNew, 1, "窗口外 OLD1 被过滤、开仓行不落库，仅 1 笔入库");
  assert.equal((first as any).records.fetched, 4);
  assert.equal((first as any).records.inWindow, 3);
  assert.equal((first as any).skippedEvents, 1);
  assert.equal((first as any).openRowsUnmatched, 0, "开仓行被平仓行消费");
  const second = await syncBitget(UA, { from: "2026-09-01", to: "2026-09-30", keyLabel: "默认", login: "bitget-t", dryRun: true }, fetcher);
  assert.equal(second.rowsDup, 1, "二次 dryRun 全 dup（幂等）");
  assert.equal(second.rowsNew, 0);
  const { rows } = await pool.query(
    `select t.ticket, t.direction, t.profit, t.net_profit, a.source
     from trades t join trade_accounts a on a.id = t.account_id where a.login = 'bitget-t'`,
  );
  assert.equal(rows[0].ticket, "C22675709");
  assert.equal(rows[0].direction, "buy");
  assert.equal(Number(rows[0].profit), 1.44);
  assert.equal(Number(rows[0].net_profit), 1.44, "生成列净额=cashFlow（零费用）");
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
