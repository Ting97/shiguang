/**
 * Bitget UTA 同步（docs/16，finance/trading 子域）：
 * - keys：只读 API 凭据绑定（secret/passphrase AES-256-GCM 加密落库，EXCHANGE_ENC_KEY 派生）
 * - sync 主通道：/api/v3/trade/fills 合约成交明细（自主 + 跟单镜像统一在此）→ 平仓单归组成
 *   「一张平仓单一条 trade」；副通道：CFD 资金流水（CFD 产品线用户，合约用户通常 0 条）
 * 官方硬限制：成交明细仅支持近 90 天、单次 30 天（fetchUtaFills 自动 clamp + 切窗）。
 * 盈亏口径：profit=ΣexecPnl、commission=-Σfee、swap=0 → 生成列 net_profit 与 Bitget 净额一致。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { ApiError } from "@/server/platform/http/errors";
import { importTrades, type TradeRowInput } from "./trades";
import { bitgetGet, fetchUtaFills, pagedGetAll, type BitgetCred, type FetchLike } from "./bitget-client";

const EXCHANGE = "bitget";

/* ---------- 凭据加密（AES-256-GCM：iv12 + tag16 + 密文，整体 base64） ---------- */

function encKeyBytes(): Buffer {
  const raw = loadConfig().exchangeEncKey;
  if (!raw) throw new ApiError(503, "upstream", "未配置 EXCHANGE_ENC_KEY，暂不支持绑定交易所凭据");
  return createHash("sha256").update(raw).digest();
}

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKeyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encKeyBytes(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** 绑定/更新只读凭据（明文仅入参一次，不落日志）。
 * 保存前先调 account-info 即时校验——key 不存在/签名/口令错误当场报 Bitget 原因，坏凭据不落库 */
export async function saveBitgetKeys(
  userId: string,
  input: { apiKey?: string; apiSecret?: string; passphrase?: string },
  fetcher?: FetchLike,
) {
  const apiKey = input.apiKey?.trim();
  const apiSecret = input.apiSecret?.trim();
  const passphrase = input.passphrase?.trim();
  if (!apiKey || !apiSecret || !passphrase) throw ApiError.badRequest("apiKey/apiSecret/passphrase 均必填");
  if (apiKey.length > 128 || apiSecret.length > 256 || passphrase.length > 128) {
    throw ApiError.badRequest("凭据长度非法");
  }
  await bitgetGet({ apiKey, apiSecret, passphrase }, "/api/v3/account/info", {}, fetcher);
  await pool.query(
    `insert into user_exchange_keys (user_id, exchange, api_key, api_secret_enc, passphrase_enc, updated_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (user_id, exchange) do update
       set api_key = excluded.api_key, api_secret_enc = excluded.api_secret_enc,
           passphrase_enc = excluded.passphrase_enc, updated_at = now()`,
    [userId, EXCHANGE, apiKey, encryptSecret(apiSecret), encryptSecret(passphrase)],
  );
  return { ok: true as const };
}

/** 绑定状态：只回掩码 key（前4***后4），不回任何明文/密文 */
export async function getBitgetKeysStatus(userId: string) {
  const { rows } = await pool.query(
    `select api_key, updated_at from user_exchange_keys where user_id = $1 and exchange = $2`,
    [userId, EXCHANGE],
  );
  const row = rows[0];
  if (!row) return { bound: false as const };
  const key = String(row.api_key);
  const masked = key.length > 8 ? `${key.slice(0, 4)}***${key.slice(-4)}` : "***";
  return { bound: true as const, apiKeyMasked: masked, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function deleteBitgetKeys(userId: string) {
  await pool.query(`delete from user_exchange_keys where user_id = $1 and exchange = $2`, [userId, EXCHANGE]);
  return { ok: true as const };
}

async function loadCred(userId: string): Promise<BitgetCred> {
  const { rows } = await pool.query(
    `select api_key, api_secret_enc, passphrase_enc from user_exchange_keys where user_id = $1 and exchange = $2`,
    [userId, EXCHANGE],
  );
  const row = rows[0];
  if (!row) throw ApiError.badRequest("尚未绑定 Bitget API 凭据，请先在交易复盘页绑定");
  return {
    apiKey: String(row.api_key),
    apiSecret: decryptSecret(String(row.api_secret_enc)),
    passphrase: decryptSecret(String(row.passphrase_enc)),
  };
}

/* ---------- 主通道：UTA 合约成交明细（/api/v3/trade/fills） ---------- */

/** 单条成交（2026-09 生产实测形态；tradeSide 带方向后缀 open_long/open_short/close_long/close_short） */
export interface UtaFill {
  execId: string;
  orderId: string;
  category?: string;
  symbol: string;
  side: "buy" | "sell";
  tradeSide: string;
  posSide?: string; // long / short（跟单场景与 tradeSide 尾缀一致）
  execPrice: string;
  execQty: string;
  execValue?: string;
  feeDetail?: { feeCoin: string; fee: string }[];
  createdTime: string; // ms
  execPnl?: string; // 平仓成交携带已实现盈亏，开仓为 0
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Number(n.toFixed(2));
const posSideOf = (f: UtaFill) => f.posSide ?? (f.tradeSide.endsWith("short") ? "short" : "long");

/**
 * UTA 成交 → trade 行（一张平仓单一条，ticket = U<orderId> 幂等键）：
 * - 平仓成交（tradeSide^close）按 orderId 聚合：手数/盈亏/费用累加，closeTime 取最晚成交
 * - 开仓时间/均价近似：同 symbol+posSide 的开仓成交按时间排序，本单消费「自上一张同向平仓单
 *   之后」的开仓段（v3 成交无 positionId，无法精确配对；无开仓成交时 openTime=closeTime、价格空）
 * - commission = -Σfee（feeDetail 为正数扣费，取负入账保 net_profit 恒等式）；swap 恒 0
 */
export function groupUtaFills(fills: UtaFill[]): { rows: TradeRowInput[]; openFillsUnmatched: number } {
  const closes = fills.filter((f) => f.tradeSide.startsWith("close"));
  const opens = fills.filter((f) => f.tradeSide.startsWith("open"));

  interface CloseAgg {
    orderId: string;
    symbol: string;
    posSide: string;
    direction: "buy" | "sell";
    lots: number;
    notional: number;
    profit: number;
    fee: number;
    closeTs: number;
  }
  const agg = new Map<string, CloseAgg>();
  for (const f of closes) {
    const cur = agg.get(f.orderId) ?? {
      orderId: f.orderId,
      symbol: f.symbol || "UNKNOWN",
      posSide: posSideOf(f),
      direction: (f.tradeSide.endsWith("short") ? "sell" : "buy") as "buy" | "sell",
      lots: 0,
      notional: 0,
      profit: 0,
      fee: 0,
      closeTs: 0,
    };
    const qty = num(f.execQty);
    cur.lots += qty;
    cur.notional += num(f.execValue) || num(f.execPrice) * qty;
    cur.profit += num(f.execPnl);
    for (const fd of f.feeDetail ?? []) cur.fee += num(fd.fee);
    cur.closeTs = Math.max(cur.closeTs, Number(f.createdTime) || 0);
    agg.set(f.orderId, cur);
  }

  // 开仓成交按 (symbol,posSide) 时间线组织，供平仓单顺序消费
  const openLines = new Map<string, { ts: number; qty: number; notional: number }[]>();
  for (const f of opens) {
    const key = `${f.symbol}|${posSideOf(f)}`;
    const line = openLines.get(key) ?? [];
    line.push({ ts: Number(f.createdTime) || 0, qty: num(f.execQty), notional: num(f.execPrice) * num(f.execQty) });
    openLines.set(key, line);
  }
  for (const line of openLines.values()) line.sort((a, b) => a.ts - b.ts);

  const rows: TradeRowInput[] = [];
  const consumed = new Map<string, number>();
  for (const c of [...agg.values()].sort((a, b) => a.closeTs - b.closeTs)) {
    const key = `${c.symbol}|${c.posSide}`;
    const line = openLines.get(key) ?? [];
    let idx = consumed.get(key) ?? 0;
    let openTs: number | null = null;
    let openNotional = 0;
    let openQty = 0;
    while (idx < line.length && line[idx].ts <= c.closeTs) {
      if (openTs === null) openTs = line[idx].ts;
      openNotional += line[idx].notional;
      openQty += line[idx].qty;
      idx++;
    }
    consumed.set(key, idx);
    rows.push({
      ticket: `U${c.orderId}`,
      symbol: c.symbol,
      direction: c.direction,
      openTime: new Date(openTs ?? c.closeTs).toISOString(),
      closeTime: new Date(c.closeTs).toISOString(),
      lots: c.lots > 0 ? Number(c.lots.toFixed(6)) : 1,
      openPrice: openQty > 0 ? Number((openNotional / openQty).toFixed(6)) : null,
      closePrice: c.lots > 0 ? Number((c.notional / c.lots).toFixed(6)) : null,
      profit: r2(c.profit),
      commission: r2(-c.fee),
      swap: 0,
    });
  }
  const used = [...consumed.values()].reduce((s, v) => s + v, 0);
  return { rows, openFillsUnmatched: opens.length - used };
}

/* ---------- 副通道：CFD 资金流水 ---------- */

export interface BitgetRecord {
  id: string;
  orderId?: string;
  symbol: string;
  bizType?: string;
  type: string;
  amount: string;
  ts: string;
}

const RECORD_TYPES = new Set(["position_close", "commission", "swap"]);

/**
 * CFD 流水归组（无成交订单端点可用——fill-history 已 40404 下线，orders 恒传空）：
 * position_close 流水 → trade 行（ticket = C<orderId>，C 前缀防与 UTA 的 U 前缀撞型）；
 * 手续费/隔夜费按 orderId 归属；匹配不到计数上报不落数。
 */
export function groupBitgetTrades(records: BitgetRecord[]): {
  rows: TradeRowInput[];
  unmatchedCommission: number;
  unmatchedSwap: number;
  skippedOthers: number;
} {
  const closes = records
    .filter((r) => r.type === "position_close")
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const fees = records.filter((r) => r.type === "commission" || r.type === "swap");
  const usedFeeIds = new Set<string>();

  const rows: TradeRowInput[] = [];
  for (const p of closes) {
    let commission = 0;
    let swap = 0;
    for (const f of fees) {
      if (!p.orderId || String(f.orderId ?? "") !== String(p.orderId)) continue;
      usedFeeIds.add(f.id);
      const amt = Number(f.amount);
      if (Number.isFinite(amt)) {
        if (f.type === "commission") commission += amt;
        else swap += amt;
      }
    }
    const profit = Number(p.amount);
    if (!Number.isFinite(profit)) continue; // 畸形流水跳过
    rows.push({
      ticket: `C${p.orderId ?? p.id}`,
      symbol: p.symbol || "UNKNOWN",
      direction: "buy", // 无订单侧信息可反转，兜底多头（仅影响展示）
      openTime: new Date(Number(p.ts)).toISOString(),
      closeTime: new Date(Number(p.ts)).toISOString(),
      lots: 1,
      openPrice: null,
      closePrice: null,
      profit,
      commission: Number(commission.toFixed(2)),
      swap: Number(swap.toFixed(2)),
    });
  }

  const unmatchedCommission = fees.filter((f) => f.type === "commission" && !usedFeeIds.has(f.id)).length;
  const unmatchedSwap = fees.filter((f) => f.type === "swap" && !usedFeeIds.has(f.id)).length;
  const skippedOthers = records.filter((r) => !RECORD_TYPES.has(r.type)).length;
  return { rows, unmatchedCommission, unmatchedSwap, skippedOthers };
}

/* ---------- 同步 ---------- */

export interface SyncBitgetBody {
  login?: string;
  nickname?: string;
  from: string; // YYYY-MM-DD（北京日历日）
  to: string;
  dryRun?: boolean;
}

/**
 * 手动同步：主通道拉 UTA 合约成交（近 90 天硬限制，超出部分自动截断并在摘要 clippedFrom 说明），
 * 副通道拉 CFD 资金流水（合约用户通常 0 条）。两通道落同一交易账号（login），ticket 前缀防撞型。
 */
export async function syncBitget(userId: string, body: SyncBitgetBody, fetcher?: FetchLike) {
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw ApiError.badRequest("from/to 需为 YYYY-MM-DD");
  }
  if (Date.parse(from) > Date.parse(to)) throw ApiError.badRequest("from 不能晚于 to");
  // 窗口按北京日历日展开为 UTC 毫秒（+08:00），与复盘模块日切口径一致
  const fromTimeMs = Date.parse(`${from}T00:00:00+08:00`);
  const toTimeMs = Date.parse(`${to}T23:59:59+08:00`);
  const cred = await loadCred(userId);
  const login = (body.login ?? "").trim() || `bitget-${userId.slice(0, 8)}`;

  const out: Record<string, unknown> = {};
  let rowsNew = 0;
  let rowsDup = 0;

  // —— 主通道：UTA 合约成交明细（自主 + 跟单镜像统一在此）——
  const { fills, effectiveFromMs } = await fetchUtaFills<UtaFill>(cred, fromTimeMs, toTimeMs, { fetcher });
  const grouped = groupUtaFills(fills);
  const utaResult = grouped.rows.length
    ? await importTrades(userId, {
        login,
        nickname: body.nickname,
        source: "bitget_api",
        fileName: `bitget-uta ${from}~${to}`,
        rows: grouped.rows,
        dryRun: body.dryRun,
      })
    : { rowsNew: 0, rowsDup: 0 };
  out.uta = { ...utaResult, fills: fills.length, openFillsUnmatched: grouped.openFillsUnmatched };
  if (effectiveFromMs > fromTimeMs) out.clippedFrom = new Date(effectiveFromMs).toISOString().slice(0, 10);
  rowsNew += utaResult.rowsNew;
  rowsDup += utaResult.rowsDup;

  // —— 副通道：CFD 资金流水（CFD 产品线；合约用户通常 0 条，不影响主通道）——
  const records = await pagedGetAll<BitgetRecord>(
    cred,
    "/api/v3/cfd/account/financial-records",
    { fromTime: fromTimeMs, toTime: toTimeMs },
    { fetcher, fromTimeMs },
  );
  const cfd = groupBitgetTrades(records);
  const cfdResult = cfd.rows.length
    ? await importTrades(userId, {
        login,
        nickname: body.nickname,
        source: "bitget_api",
        fileName: `bitget-cfd ${from}~${to}`,
        rows: cfd.rows,
        dryRun: body.dryRun,
      })
    : { rowsNew: 0, rowsDup: 0 };
  out.cfd = {
    ...cfdResult,
    records: records.length,
    unmatchedCommission: cfd.unmatchedCommission,
    unmatchedSwap: cfd.unmatchedSwap,
    skippedOthers: cfd.skippedOthers,
  };
  rowsNew += cfdResult.rowsNew;
  rowsDup += cfdResult.rowsDup;

  return { ...out, rowsNew, rowsDup };
}
