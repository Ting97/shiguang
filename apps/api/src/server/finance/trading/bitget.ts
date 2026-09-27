/**
 * Bitget UTA CFD 同步（docs/16，finance/trading 子域）：
 * - keys：只读 API 凭据绑定（secret/passphrase AES-256-GCM 加密落库，EXCHANGE_ENC_KEY 派生）
 * - sync：资金流水（position_close/commission/swap 事件）+ 历史订单 → 按 orderId/positionId 归组成
 *   「一笔平仓一条 trade」→ 复用 importTrades upsert 去重
 * 盈亏口径：position_close 事件金额为权威已实现盈亏；手续费/隔夜费按 orderId/持仓归属拆进
 * commission/swap 列，生成列 net_profit = 三者之和与 Bitget 净额口径一致。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { ApiError } from "@/server/platform/http/errors";
import { importTrades, type TradeRowInput } from "./trades";
import { bitgetGet, pagedGetAll, type BitgetCred, type FetchLike } from "./bitget-client";

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

/** 绑定/更新只读凭据（明文仅入参一次，不落日志） */
export async function saveBitgetKeys(
  userId: string,
  input: { apiKey?: string; apiSecret?: string; passphrase?: string },
) {
  const apiKey = input.apiKey?.trim();
  const apiSecret = input.apiSecret?.trim();
  const passphrase = input.passphrase?.trim();
  if (!apiKey || !apiSecret || !passphrase) throw ApiError.badRequest("apiKey/apiSecret/passphrase 均必填");
  if (apiKey.length > 128 || apiSecret.length > 256 || passphrase.length > 128) {
    throw ApiError.badRequest("凭据长度非法");
  }
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

/* ---------- 上游数据形态（docs/16 契约） ---------- */

export interface BitgetRecord {
  id: string;
  orderId?: string;
  symbol: string;
  bizType?: string;
  type: string;
  amount: string;
  ts: string;
}

export interface BitgetOrder {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  avgFillPrice?: string;
  quantity?: string;
  filledQuantity?: string;
  fillTS?: string;
  placeTS?: string;
  positionId?: string;
}

const RECORD_TYPES = new Set(["position_close", "commission", "swap"]);

export interface GroupResult {
  rows: TradeRowInput[];
  unmatchedCommission: number; // 归属不到任何平仓的手续费事件数（多为窗口外开仓费）
  unmatchedSwap: number;
  skippedOthers: number; // 出入金等非成交事件
  lotsFallback: number; // 平仓单缺失、手数回退为 1 的行数
}

/**
 * 归组：position_close 流水 → trade 行（ticket=orderId，天然幂等去重键）；
 * 手续费/隔夜费按「本平仓单 + 同 positionId 的开仓单」归属；匹配不到计数上报不落数。
 */
export function groupBitgetTrades(records: BitgetRecord[], orders: BitgetOrder[]): GroupResult {
  const orderById = new Map(orders.map((o) => [String(o.orderId), o]));
  const closes = records
    .filter((r) => r.type === "position_close")
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const fees = records.filter((r) => r.type === "commission" || r.type === "swap");
  const usedFeeIds = new Set<string>();

  let lotsFallback = 0;
  const rows: TradeRowInput[] = [];

  for (const p of closes) {
    const closeOrder = p.orderId ? orderById.get(String(p.orderId)) : undefined;
    const positionId = closeOrder?.positionId;
    // CFD 单向持仓：平仓单 side 与持仓方向相反 → MT5 语义的 direction 取持仓方向
    const direction: "buy" | "sell" = closeOrder ? (closeOrder.side === "sell" ? "buy" : "sell") : "buy";
    const opens = positionId
      ? orders.filter((o) => o.positionId === positionId && o.orderId !== p.orderId && o.side === direction)
      : [];
    const openIds = new Set(opens.map((o) => String(o.orderId)));

    let commission = 0;
    let swap = 0;
    for (const f of fees) {
      const fo = f.orderId ? String(f.orderId) : "";
      const mine = fo === String(p.orderId) || openIds.has(fo);
      if (!mine) continue;
      usedFeeIds.add(f.id);
      const amt = Number(f.amount);
      if (Number.isFinite(amt)) {
        if (f.type === "commission") commission += amt;
        else swap += amt;
      }
    }

    // 开仓价：开仓单按手数加权均价；平仓价：平仓单均价
    let openPrice: number | null = null;
    let openLots = 0;
    let openNotional = 0;
    for (const o of opens) {
      const px = Number(o.avgFillPrice);
      const qty = Number(o.filledQuantity ?? o.quantity ?? 0);
      if (Number.isFinite(px) && qty > 0) {
        openNotional += px * qty;
        openLots += qty;
      }
    }
    if (openLots > 0) openPrice = Number((openNotional / openLots).toFixed(5));

    const qty = Number(closeOrder?.filledQuantity ?? closeOrder?.quantity ?? 0);
    if (!(qty > 0)) lotsFallback++;

    const profit = Number(p.amount);
    if (!Number.isFinite(profit)) continue; // 畸形流水跳过（计数在 skippedOthers 外不再细分）

    const openTs = opens.length > 0 ? Math.min(...opens.map((o) => Number(o.fillTS ?? o.placeTS ?? Number(p.ts)))) : Number(p.ts);
    const closeTs = Number(closeOrder?.fillTS ?? p.ts);
    rows.push({
      ticket: String(p.orderId ?? p.id), // orderId 空的极端行退化为流水 id，仍保幂等
      symbol: p.symbol || closeOrder?.symbol || "UNKNOWN",
      direction,
      openTime: new Date(openTs).toISOString(),
      closeTime: new Date(closeTs).toISOString(),
      lots: qty > 0 ? qty : 1,
      openPrice,
      closePrice: Number(closeOrder?.avgFillPrice) || null,
      profit,
      commission: Number(commission.toFixed(2)),
      swap: Number(swap.toFixed(2)),
    });
  }

  const unmatchedCommission = fees.filter((f) => f.type === "commission" && !usedFeeIds.has(f.id)).length;
  const unmatchedSwap = fees.filter((f) => f.type === "swap" && !usedFeeIds.has(f.id)).length;
  const skippedOthers = records.filter((r) => !RECORD_TYPES.has(r.type)).length;
  return { rows, unmatchedCommission, unmatchedSwap, skippedOthers, lotsFallback };
}

/* ---------- 同步 ---------- */

export interface SyncBitgetBody {
  login?: string;
  nickname?: string;
  from: string; // YYYY-MM-DD（北京日历日）
  to: string;
  dryRun?: boolean;
  /**
   * 数据范围（docs/16 场景 A/B）：
   * - self（默认）：本账户 CFD——自主交易 + 跟单镜像平仓都落在这（跟单者场景 B 无需单独拉取）
   * - trader：带单仓位（交易员场景 A，/api/v3/cfd/copy-trading/track-positions/history）
   * - all：两者都拉；带单落到独立账号（login-track）与本账户分开统计权益曲线
   */
  scope?: "self" | "trader" | "all";
}

/** CFD 带单历史仓位（docs/16 场景 A 契约；一条记录即一笔完整开平，含费用与分润） */
export interface BitgetTrackPosition {
  positionId: string;
  symbol: string;
  bizType?: string;
  holdSide?: string; // long/short
  totalQuantity?: string;
  openAvgPrice?: string;
  closeAvgPrice?: string;
  openFee?: string;
  closeFee?: string;
  swapFee?: string;
  realizedPnl?: string;
  netProfit?: string;
  profitShareAmount?: string;
  openTime?: string;
  closeTime?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Number(n.toFixed(2));

/**
 * 带单仓位 → trade 行（ticket = T-<positionId> 前缀防与 orderId 空间撞型）。
 * 费用恒等式：profit = netProfit - openFee - closeFee - swapFee，commission = openFee+closeFee，
 * swap = swapFee —— 三项与 profit 相加恒等于 netProfit（符号随上游口径，恒等式不受影响），
 * 生成列 net_profit 与 Bitget 净额一致。仅收已平仓位（closeTime 缺失 = 持仓中，复盘不收）。
 */
export function mapTrackPositions(list: BitgetTrackPosition[]): TradeRowInput[] {
  return list
    .filter((p) => p.positionId && p.closeTime)
    .map((p) => {
      const openFee = num(p.openFee);
      const closeFee = num(p.closeFee);
      const swapFee = num(p.swapFee);
      const net = num(p.netProfit ?? p.realizedPnl);
      return {
        ticket: `T-${p.positionId}`,
        symbol: p.symbol || "UNKNOWN",
        direction: p.holdSide === "short" ? ("sell" as const) : ("buy" as const),
        openTime: new Date(Number(p.openTime ?? p.closeTime)).toISOString(),
        closeTime: new Date(Number(p.closeTime)).toISOString(),
        lots: num(p.totalQuantity) > 0 ? num(p.totalQuantity) : 1,
        openPrice: num(p.openAvgPrice) || null,
        closePrice: num(p.closeAvgPrice) || null,
        profit: r2(net - openFee - closeFee - swapFee),
        commission: r2(openFee + closeFee),
        swap: r2(swapFee),
      };
    });
}

/** 带单历史分页拉取：游标用 positionId（接口无独立 id 字段，与流水分页不同） */
async function fetchTrackHistory(cred: BitgetCred, fromTimeMs: number, toTimeMs: number, fetcher?: FetchLike): Promise<BitgetTrackPosition[]> {
  const out: BitgetTrackPosition[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const page = await bitgetGet<BitgetTrackPosition[]>(
      cred,
      "/api/v3/cfd/copy-trading/track-positions/history",
      { fromTime: fromTimeMs, toTime: toTimeMs, idLessThan: cursor, limit: 200 },
      fetcher,
    );
    const list = Array.isArray(page) ? page : [];
    if (list.length === 0) break;
    out.push(...list);
    const last = list.at(-1);
    if (list.length < 200 || !last?.positionId) break;
    cursor = last.positionId;
  }
  return out;
}

export async function syncBitget(userId: string, body: SyncBitgetBody, fetcher?: FetchLike) {
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw ApiError.badRequest("from/to 需为 YYYY-MM-DD");
  }
  if (Date.parse(from) > Date.parse(to)) throw ApiError.badRequest("from 不能晚于 to");
  const scope = body.scope === "trader" || body.scope === "all" ? body.scope : "self";
  const wantSelf = scope !== "trader";
  const wantTrader = scope !== "self";
  // 窗口按北京日历日展开为 UTC 毫秒（+08:00），与复盘模块日切口径一致
  const fromTimeMs = Date.parse(`${from}T00:00:00+08:00`);
  const toTimeMs = Date.parse(`${to}T23:59:59+08:00`);
  const cred = await loadCred(userId);
  const baseLogin = (body.login ?? "").trim() || `bitget-${userId.slice(0, 8)}`;

  const out: Record<string, unknown> = { scope };
  let rowsNew = 0;
  let rowsDup = 0;

  // —— 场景 B：本账户（自主 + 跟单镜像平仓，同一通道无需区分）——
  if (wantSelf) {
    const records = await pagedGetAll<BitgetRecord>(
      cred,
      "/api/v3/cfd/account/financial-records",
      { fromTime: fromTimeMs, toTime: toTimeMs },
      { fetcher, fromTimeMs },
    );
    const orders = await pagedGetAll<BitgetOrder>(
      cred,
      "/api/v3/cfd/trade/history-orders",
      { fromTime: fromTimeMs, toTime: toTimeMs },
      { fetcher, fromTimeMs },
    );
    const grouped = groupBitgetTrades(records, orders);
    const result = grouped.rows.length > 0
      ? await importTrades(userId, {
          login: baseLogin,
          nickname: body.nickname,
          source: "bitget_api",
          fileName: `bitget ${from}~${to}`,
          rows: grouped.rows,
          dryRun: body.dryRun,
        })
      : { rowsNew: 0, rowsDup: 0 };
    out.self = {
      ...result,
      events: { records: records.length, orders: orders.length },
      unmatchedCommission: grouped.unmatchedCommission,
      unmatchedSwap: grouped.unmatchedSwap,
      skippedOthers: grouped.skippedOthers,
      lotsFallback: grouped.lotsFallback,
    };
    rowsNew += result.rowsNew;
    rowsDup += result.rowsDup;
  }

  // —— 场景 A：带单仓位（交易员）——
  if (wantTrader) {
    try {
      const tracks = await fetchTrackHistory(cred, fromTimeMs, toTimeMs, fetcher);
      const rows = mapTrackPositions(tracks);
      const result = rows.length > 0
        ? await importTrades(userId, {
            login: `${baseLogin}-track`,
            nickname: body.nickname ? `带单·${body.nickname}` : "带单·Bitget",
            source: "bitget_api",
            fileName: `bitget-track ${from}~${to}`,
            rows,
            dryRun: body.dryRun,
          })
        : { rowsNew: 0, rowsDup: 0 };
      out.trader = {
        ...result,
        positions: tracks.length,
        // 分润是交易员收入但不属交易盈亏：只进对账摘要，不落 trades（避免污染净额口径）
        profitShareAmount: r2(tracks.reduce((s, p) => s + num(p.profitShareAmount), 0)),
      };
      rowsNew += result.rowsNew;
      rowsDup += result.rowsDup;
    } catch (e) {
      // 双范围时带单失败不阻塞本账户（常见：该账号不是带单交易员）；纯带单范围则直接抛
      if (!wantSelf) throw e;
      out.trader = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ...out, rowsNew, rowsDup };
}
