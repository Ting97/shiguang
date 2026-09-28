/**
 * Bitget UTA 同步回归（docs/16）：
 * - 签名：固定向量比对 prehash → HMAC-SHA256 → Base64（用 node crypto 独立重算，双实现一致性）
 * - fetchUtaFills：90 天 clamp + 25 天切窗（stub 观察请求参数）
 * - 归组：UTA 平仓单按 orderId 聚合、开仓区间近似、fee 取负入账；CFD 流水 fee 按 orderId 归属
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
  const headers = signRequest(cred, "GET", "/api/v3/trade/fills", "category=USDT-FUTURES&limit=100", "", ts);
  // 独立重算 prehash：timestamp + method + path + ?query + body
  const expect = createHmac("sha256", "secret-2222")
    .update(`${ts}GET/api/v3/trade/fills?category=USDT-FUTURES&limit=100`)
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

test("bitget：fetchUtaFills——90 天 clamp + 切窗 + cursor 翻页（stub 观察参数）", async () => {
  await ensureLoaded();
  const { fetchUtaFills } = await import("../src/server/finance/trading/bitget-client");
  const cred = { apiKey: "k", apiSecret: "s", passphrase: "p" };
  const seen: string[] = [];
  const empty = JSON.stringify({ code: "00000", data: { list: null, cursor: null } });
  const fetcher = (url: string) => {
    seen.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(empty) });
  };
  // 起点终点都早于 90 天线：整窗无效，不发请求
  const r0 = await fetchUtaFills(cred, Date.parse("2020-01-01"), Date.parse("2020-01-05"), { fetcher });
  assert.equal(r0.fills.length, 0);
  assert.equal(seen.length, 0, "90 天外整窗不发请求");
  assert.ok(r0.effectiveFromMs > Date.now() - 91 * 86_400_000, "effectiveFrom 仍给出 clamp 后起点");
  // 跨 90 天线：clamp 生效，首窗起点即 clamp 后起点
  const r1 = await fetchUtaFills(cred, Date.now() - 100 * 86_400_000, Date.now(), { fetcher });
  assert.equal(r1.fills.length, 0);
  assert.ok(seen.length >= 4, "89 天跨度按 25 天切多窗");
  const first = new URL(seen[0]);
  assert.equal(first.pathname, "/api/v3/trade/fills");
  assert.equal(first.searchParams.get("category"), "USDT-FUTURES");
  assert.equal(first.searchParams.get("limit"), "100");
  assert.ok(Number(first.searchParams.get("startTime")) >= r1.effectiveFromMs - 1000, "首窗起点即 clamp 后起点");
  // 超出窗口完全在 90 天内且无数据：单窗一页即停
  seen.length = 0;
  await fetchUtaFills(cred, Date.now() - 3 * 86_400_000, Date.now(), { fetcher });
  assert.equal(seen.length, 1, "短窗无数据一页即停");
});

const CLOSE_A = {
  execId: "E1", orderId: "OC1", category: "USDT-FUTURES", symbol: "ETHUSDT", orderType: "market",
  side: "buy", tradeSide: "close_short", posSide: "short", execPrice: "1883.98", execQty: "5.33",
  execValue: "10041.6134", tradeScope: "taker", feeDetail: [{ feeCoin: "USDT", fee: "3.21331628" }],
  createdTime: "1785040017002", execPnl: "-17.75553467",
};
const CLOSE_A2 = {
  ...CLOSE_A, execId: "E2", execQty: "2", execValue: "3767.96", execPnl: "-5", feeDetail: [{ feeCoin: "USDT", fee: "1" }],
  createdTime: "1785040018000",
};
const OPEN_A = {
  ...CLOSE_A, execId: "E0", orderId: "OO1", side: "sell", tradeSide: "open_short", execPrice: "1900",
  execQty: "7.33", execValue: "13927", feeDetail: [{ feeCoin: "USDT", fee: "2.5" }], execPnl: "0",
  createdTime: "1785030000000",
};
const CLOSE_B = {
  ...CLOSE_A, execId: "E3", orderId: "OC2", symbol: "BTCUSDT", tradeSide: "close_long", posSide: "long",
  side: "sell", execPrice: "60000", execQty: "0.01", execValue: "600", feeDetail: [{ feeCoin: "USDT", fee: "0.3" }],
  execPnl: "12.5", createdTime: "1785100000000",
};

test("bitget：UTA 归组——平仓单聚合/开仓区间近似/fee 取负/无开仓兜底", async () => {
  await ensureLoaded();
  const { groupUtaFills } = await import("../src/server/finance/trading/bitget");
  const { rows, openFillsUnmatched } = groupUtaFills([CLOSE_A, CLOSE_A2, OPEN_A, CLOSE_B] as never[]);
  assert.equal(openFillsUnmatched, 0, "开仓成交被区间消费");
  assert.equal(rows.length, 2, "一张平仓单一条（OC1 两笔部分成交合并）");

  const eth = rows.find((r) => r.symbol === "ETHUSDT")!;
  assert.equal(eth.ticket, "UOC1");
  assert.equal(eth.direction, "sell", "close_short → 持仓方向 short");
  assert.equal(eth.lots, 7.33);
  assert.equal(eth.profit, -22.76, "ΣexecPnl 保留 2 位");
  assert.equal(eth.commission, -4.21, "feeDetail 正数扣费取负入账");
  assert.equal(eth.swap, 0);
  assert.equal(eth.closePrice, 1883.98, "平仓价按名义价值加权");
  assert.equal(eth.openPrice, 1900, "开仓价取区间开仓成交加权");
  assert.equal(eth.openTime, new Date(1785030000000).toISOString());
  assert.equal(eth.closeTime, new Date(1785040018000).toISOString());

  assert.ok(rows.every((r) => (r.swap ?? 0) === 0), "UTA 行 swap 恒 0（资金费不在成交明细）");

  const btc = rows.find((r) => r.symbol === "BTCUSDT")!;
  assert.equal(btc.ticket, "UOC2");
  assert.equal(btc.direction, "buy", "close_long → 持仓方向 long");
  assert.equal(btc.openPrice, null, "无区间开仓成交 → 价格空");
  assert.equal(btc.openTime, btc.closeTime, "开仓时间兜底为平仓时间");
  assert.equal(btc.profit, 12.5);
  assert.equal(btc.commission, -0.3);
});

test("bitget：CFD 流水归组——fee 按 orderId 归属/ticket C 前缀/未匹配计数", async () => {
  await ensureLoaded();
  const { groupBitgetTrades } = await import("../src/server/finance/trading/bitget");
  const g = groupBitgetTrades([
    { id: "R1", orderId: "TO-1", symbol: "XAUUSD", type: "position_close", amount: "300", ts: "1700000000000" },
    { id: "R2", orderId: "TO-1", symbol: "XAUUSD", type: "commission", amount: "-2", ts: "1700000000001" },
    { id: "R3", orderId: "TO-X", symbol: "XAUUSD", type: "swap", amount: "-0.5", ts: "1700000000002" },
    { id: "R4", orderId: "", symbol: "", type: "deposit", amount: "10000", ts: "1700000000003" },
  ]);
  assert.equal(g.rows.length, 1);
  assert.equal(g.rows[0].ticket, "CTO-1", "C 前缀防与 UTA 的 U 前缀撞型");
  assert.equal(g.rows[0].profit, 300);
  assert.equal(g.rows[0].commission, -2);
  assert.equal(g.unmatchedSwap, 1, "orderId 对不上的隔夜费计数");
  assert.equal(g.skippedOthers, 1, "出入金跳过");
});

test("bitget：同步 stub 上游——UTA 落库 + CFD 零条 + 二次幂等全 dup", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  process.env.EXCHANGE_ENC_KEY = "test-enc-key";
  await pool.query(`insert into profiles (id, nickname) values ($1,'bitget测试') on conflict (id) do nothing`, [UA]);
  const { saveBitgetKeys, syncBitget, getBitgetKeysStatus } = await import("../src/server/finance");
  const ok = (data: unknown) => JSON.stringify({ code: "00000", data });
  const fetcher = (url: string) => {
    if (url.includes("/api/v3/account/info")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok({})) });
    if (url.includes("/api/v3/trade/fills")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok({ list: [OPEN_A, CLOSE_A, CLOSE_A2, CLOSE_B], cursor: null })) });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok([])) }); // CFD 流水 0 条
  };
  await saveBitgetKeys(UA, { apiKey: "k-2222", apiSecret: "s-2222", passphrase: "p-2222" }, fetcher);
  const status = await getBitgetKeysStatus(UA);
  assert.ok(status.bound && status.apiKeyMasked.includes("***"), "状态只回掩码");

  const first = await syncBitget(UA, { from: "2026-09-20", to: "2026-09-27", login: "bitget-t", dryRun: false }, fetcher);
  assert.equal(first.rowsNew, 2, "UTA 两张平仓单");
  assert.equal((first as any).uta.fills, 4);
  assert.equal((first as any).cfd.records, 0, "CFD 零条不影响主通道");
  const second = await syncBitget(UA, { from: "2026-09-20", to: "2026-09-27", login: "bitget-t", dryRun: true }, fetcher);
  assert.equal(second.rowsDup, 2, "二次 dryRun 全 dup（幂等）");
  assert.equal(second.rowsNew, 0);
  const { rows } = await pool.query(
    `select t.ticket, t.direction, t.profit, t.commission, t.net_profit, a.source
     from trades t join trade_accounts a on a.id = t.account_id where a.login = 'bitget-t' order by t.ticket`,
  );
  assert.deepEqual(rows.map((r: any) => r.ticket), ["UOC1", "UOC2"]);
  const eth = rows.find((r: any) => r.ticket === "UOC1");
  assert.equal(eth.direction, "sell");
  assert.equal(Number(eth.profit), -22.76);
  assert.equal(Number(eth.commission), -4.21);
  assert.equal(Number(eth.net_profit), -26.97, "生成列净额 = profit + commission");
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
