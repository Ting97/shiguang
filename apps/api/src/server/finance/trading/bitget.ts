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

const DEFAULT_KEY_LABEL = "默认";

/** 绑定/更新一把只读凭据（label 区分多把——主账号/子账号各自绑定；明文仅入参一次，不落日志）。
 * 保存前先调 account-info 即时校验——key 不存在/签名/口令错误当场报 Bitget 原因，坏凭据不落库 */
export async function saveBitgetKeys(
  userId: string,
  input: { apiKey?: string; apiSecret?: string; passphrase?: string; label?: string },
  fetcher?: FetchLike,
) {
  const apiKey = input.apiKey?.trim();
  const apiSecret = input.apiSecret?.trim();
  const passphrase = input.passphrase?.trim();
  const label = (input.label ?? "").trim() || DEFAULT_KEY_LABEL;
  if (!apiKey || !apiSecret || !passphrase) throw ApiError.badRequest("apiKey/apiSecret/passphrase 均必填");
  if (label.length > 32) throw ApiError.badRequest("密钥备注名过长（≤32 字）");
  if (apiKey.length > 128 || apiSecret.length > 256 || passphrase.length > 128) {
    throw ApiError.badRequest("凭据长度非法");
  }
  await bitgetGet({ apiKey, apiSecret, passphrase }, "/api/v3/account/info", {}, fetcher);
  await pool.query(
    `insert into user_exchange_keys (user_id, exchange, label, api_key, api_secret_enc, passphrase_enc, updated_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (user_id, exchange, label) do update
       set api_key = excluded.api_key, api_secret_enc = excluded.api_secret_enc,
           passphrase_enc = excluded.passphrase_enc, updated_at = now()`,
    [userId, EXCHANGE, label, apiKey, encryptSecret(apiSecret), encryptSecret(passphrase)],
  );
  return { ok: true as const, label };
}

/** 绑定状态：逐把回掩码 key（前4***后4），不回任何明文/密文 */
export async function getBitgetKeysStatus(userId: string) {
  const { rows } = await pool.query(
    `select label, api_key, updated_at from user_exchange_keys where user_id = $1 and exchange = $2 order by updated_at`,
    [userId, EXCHANGE],
  );
  if (rows.length === 0) return { bound: false as const, keys: [] as { label: string; apiKeyMasked: string; updatedAt: string }[] };
  return {
    bound: true as const,
    keys: rows.map((row) => {
      const key = String(row.api_key);
      const masked = key.length > 8 ? `${key.slice(0, 4)}***${key.slice(-4)}` : "***";
      return { label: String(row.label), apiKeyMasked: masked, updatedAt: new Date(row.updated_at).toISOString() };
    }),
  };
}

/** 删除指定 label 的密钥；不传 label 删全部 */
export async function deleteBitgetKeys(userId: string, label?: string) {
  if (label) {
    await pool.query(`delete from user_exchange_keys where user_id = $1 and exchange = $2 and label = $3`, [
      userId,
      EXCHANGE,
      label,
    ]);
  } else {
    await pool.query(`delete from user_exchange_keys where user_id = $1 and exchange = $2`, [userId, EXCHANGE]);
  }
  return { ok: true as const };
}

async function loadCred(userId: string, label: string): Promise<BitgetCred> {
  const { rows } = await pool.query(
    `select api_key, api_secret_enc, passphrase_enc from user_exchange_keys
     where user_id = $1 and exchange = $2 and label = $3`,
    [userId, EXCHANGE, label],
  );
  const row = rows[0];
  if (!row) throw ApiError.badRequest(`尚未绑定 Bitget API 凭据（${label}），请先在交易复盘页绑定`);
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
 * CFD 流水 → trade 行（一笔平仓一条，ticket = C<orderId> 幂等键）。
 * 行类型区分（生产实测）：
 * - 开仓行：closePrice=0 且 cashFlow=0、openPrice>0、fee=开仓手续费 —— 不生成 trade，
 *   进 per-symbol 栈供平仓行配对（openTime 取其 ts、开仓费归入 trade.commission）
 * - 平仓行：closePrice≠0 或 cashFlow≠0 —— 生成 trade；行内自带 openPrice（开仓均价）
 * 盈亏拆分（fee/swap 上游支出为负）：profit = cashFlow - fee平 - swap平（价差毛利）、
 * commission = fee开 + fee平、swap = swap平 → net_profit = cashFlow + fee开 = 该笔交易总资金影响。
 * direction = side 反转（流水记平仓动作方向）；开仓时间配不到时兜底=平仓时间。
 * symbol 空（出入金）与 orderId="0" 的行跳过并计数。
 */
export function groupCfdRecords(records: CfdRecord[]): {
  rows: TradeRowInput[];
  skippedEvents: number;
  openRowsUnmatched: number;
} {
  const rows: TradeRowInput[] = [];
  let skippedEvents = 0;
  // per-symbol 开仓行栈（LIFO：高频短线后开先平；配对只影响 openTime/开仓费归属，均为近似）。
  // ⚠ 上游翻页是新→旧返回，必须先按时间正序排（否则平仓行先到、配到更晚的开仓行，持仓时长为负）
  const sorted = [...records].sort((a, b) => Number(a.ts) - Number(b.ts));
  const openStacks = new Map<string, { ts: number; fee: number; openPrice: number; side: string }[]>();
  let openRowsUnmatched = 0;

  for (const r of sorted) {
    const orderId = String(r.orderId ?? "");
    if (!r.symbol || !orderId || orderId === "0") {
      skippedEvents++;
      continue;
    }
    const ts = Number(r.ts);
    const closePrice = num(r.closePrice);
    const cashFlow = num(r.cashFlow);

    // 开仓行：入栈待配对
    if (!closePrice && !cashFlow && num(r.openPrice)) {
      const stack = openStacks.get(r.symbol) ?? [];
      stack.push({ ts, fee: num(r.fee), openPrice: num(r.openPrice), side: String(r.side ?? "") });
      openStacks.set(r.symbol, stack);
      continue;
    }

    // 平仓行 → trade
    const feeClose = num(r.fee);
    const swapClose = num(r.swap);
    const stack = openStacks.get(r.symbol);
    let open: { ts: number; fee: number; openPrice: number } | undefined;
    const wantSide = r.side === "sell" ? "buy" : "sell"; // 平仓动作的反方向 = 开仓行 side
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!stack[i].side || stack[i].side === wantSide) {
          open = stack.splice(i, 1)[0];
          break;
        }
      }
    }
    rows.push({
      ticket: `C${orderId}`,
      symbol: r.symbol,
      direction: r.side === "sell" ? "buy" : "sell",
      openTime: new Date(open?.ts ?? ts).toISOString(),
      closeTime: new Date(ts).toISOString(),
      lots: num(r.qty) > 0 ? num(r.qty) : 1,
      openPrice: num(r.openPrice) || open?.openPrice || null,
      closePrice: closePrice || null,
      profit: r2(cashFlow - feeClose - swapClose),
      commission: r2((open?.fee ?? 0) + feeClose),
      swap: r2(swapClose),
    });
  }
  for (const stack of openStacks.values()) openRowsUnmatched += stack.length;
  return { rows, skippedEvents, openRowsUnmatched };
}

/* ---------- 同步 ---------- */

export interface SyncBitgetBody {
  /** 用哪把已绑定的密钥同步（多账号场景；缺省「默认」） */
  keyLabel?: string;
  login?: string;
  nickname?: string;
  from: string; // YYYY-MM-DD（北京日历日）
  to: string;
  dryRun?: boolean;
}

/**
 * 手动同步：按 keyLabel 取对应密钥，拉全量 CFD 资金流水（无 90 天限制，游标翻页到尽头），
 * 按北京日历日窗口过滤后归组成 trade 落库。不同密钥各自落独立交易账号（login 缺省=keyLabel），
 * 同一把 key 重复同步按平仓单 orderId 幂等去重。
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
  const keyLabel = (body.keyLabel ?? "").trim() || DEFAULT_KEY_LABEL;
  const cred = await loadCred(userId, keyLabel);
  const login = (body.login ?? "").trim() || keyLabel;

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
    keyLabel,
    records: { fetched: all.length, inWindow: inWindow.length },
    skippedEvents: grouped.skippedEvents,
    openRowsUnmatched: grouped.openRowsUnmatched,
  };
}
