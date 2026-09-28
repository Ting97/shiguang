/**
 * Bitget UTA 同步（docs/16，finance/trading 子域）：
 * - keys：只读 API 凭据绑定（secret/passphrase AES-256-GCM 加密落库，EXCHANGE_ENC_KEY 派生）
 * - sync：CFD 资金流水（/api/v3/cfd/account/financial-records，XAUUSD 等差价合约）——
 *   每行一笔平仓成交（openPrice/closePrice/cashFlow 直接齐全），symbol 空的行是出入金事件
 * ⚠ 响应为 {list, cursor} 嵌套结构（生产实测）；游标请求参数为 cursor（idLessThan 不生效）。
 * 盈亏口径：profit=cashFlow-fee-swap、commission=-fee、swap=-swap → 生成列 net_profit=cashFlow。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { ApiError } from "@/server/platform/http/errors";
import { importTrades, type TradeRowInput } from "./trades";
import { bitgetGet, fetchCfdRecords, type BitgetCred, type FetchLike } from "./bitget-client";

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

/* ---------- CFD 资金流水（生产实测形态） ---------- */

/** 流水单行：symbol 非空 = 一笔平仓成交；symbol 空 = 出入金/调整事件（orderId="0"） */
export interface CfdRecord {
  id: string;
  ts: string; // ms
  symbol: string;
  side?: string; // 平仓成交方向（与持仓方向相反）
  qty?: string;
  swap?: string; // 隔夜费（扣费额）
  fee?: string; // 手续费（扣费额；零佣金账户为 0）
  cashFlow: string; // 本事件现金流（平仓 = 已实现盈亏净额）
  balanceBefore?: string;
  balanceChange?: string;
  openPrice?: string;
  closePrice?: string;
  orderId?: string; // "0" = 非成交事件
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Number(n.toFixed(2));

/**
 * CFD 流水 → trade 行（一笔平仓一条，ticket = C<orderId> 幂等键）：
 * - direction = side 反转（流水记平仓动作方向，持仓方向相反）
 * - fee/swap/cashFlow 均为上游带符号值（生产实测 fee/swap 支出为负、cashFlow 为已扣费净额）
 *   → commission/swap 直接透传，毛利 profit = cashFlow - fee - swap，生成列 net_profit = cashFlow
 * - 开仓时间流水不含 → openTime=closeTime（CFD 无持仓历史端点，诚实降级）
 * - symbol 空（出入金）与 orderId="0" 的行跳过并计数，不落数
 */
export function groupCfdRecords(records: CfdRecord[]): { rows: TradeRowInput[]; skippedEvents: number } {
  const rows: TradeRowInput[] = [];
  let skippedEvents = 0;
  for (const r of records) {
    const orderId = String(r.orderId ?? "");
    if (!r.symbol || !orderId || orderId === "0") {
      skippedEvents++;
      continue;
    }
    const fee = num(r.fee);
    const swap = num(r.swap);
    const closePrice = num(r.closePrice);
    const qty = num(r.qty);
    const ts = new Date(Number(r.ts)).toISOString();
    rows.push({
      ticket: `C${orderId}`,
      symbol: r.symbol,
      direction: r.side === "sell" ? "buy" : "sell",
      openTime: ts,
      closeTime: ts,
      lots: qty > 0 ? qty : 1,
      openPrice: num(r.openPrice) || null,
      closePrice: closePrice || null,
      profit: r2(num(r.cashFlow) - fee - swap),
      commission: r2(fee),
      swap: r2(swap),
    });
  }
  return { rows, skippedEvents };
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
 * 手动同步：拉全量 CFD 资金流水（无 90 天限制，游标翻页到尽头），按北京日历日窗口过滤后
 * 归组成 trade 落库。与复盘模块日切口径一致（+08:00）。
 */
export async function syncBitget(userId: string, body: SyncBitgetBody, fetcher?: FetchLike) {
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw ApiError.badRequest("from/to 需为 YYYY-MM-DD");
  }
  if (Date.parse(from) > Date.parse(to)) throw ApiError.badRequest("from 不能晚于 to");
  const fromTimeMs = Date.parse(`${from}T00:00:00+08:00`);
  const toTimeMs = Date.parse(`${to}T23:59:59+08:00`);
  const cred = await loadCred(userId);
  const login = (body.login ?? "").trim() || `bitget-${userId.slice(0, 8)}`;

  const all = await fetchCfdRecords<CfdRecord>(cred, { fetcher });
  const inWindow = all.filter((r) => {
    const t = Number(r.ts);
    return t >= fromTimeMs && t <= toTimeMs;
  });
  const grouped = groupCfdRecords(inWindow);
  const result = grouped.rows.length
    ? await importTrades(userId, {
        login,
        nickname: body.nickname,
        source: "bitget_api",
        fileName: `bitget-cfd ${from}~${to}`,
        rows: grouped.rows,
        dryRun: body.dryRun,
      })
    : { rowsNew: 0, rowsDup: 0 };

  return {
    ...result,
    records: { fetched: all.length, inWindow: inWindow.length },
    skippedEvents: grouped.skippedEvents,
  };
}
