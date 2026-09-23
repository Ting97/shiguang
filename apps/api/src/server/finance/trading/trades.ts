/**
 * R1 MT5 投资交易 service（REQ-005 FR-1.x，finance/trading 子域）。
 * 零耦合边界：trades 不进 accounts/transactions，净资产口径不含交易账户。
 * 金额：原币种（USD）数值，非分。时区：日切/时段归类固定北京时区。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { isValidCalendarDate } from "@/server/platform/http/datetime";

export const TZ = "Asia/Shanghai";

export interface TradeRowInput {
  ticket: number | string;
  symbol?: string;
  direction: "buy" | "sell";
  openTime: string;
  closeTime: string;
  lots: number;
  openPrice?: number | null;
  closePrice?: number | null;
  profit: number;
  commission?: number;
  swap?: number;
}

export interface ImportBody {
  dryRun?: boolean;
  login: string;
  nickname?: string;
  fileName: string;
  source: "mt5_xlsx" | "csv";
  rows: TradeRowInput[];
}

function validateRows(rows: TradeRowInput[]) {
  if (!Array.isArray(rows) || rows.length === 0) throw ApiError.badRequest("rows 为空");
  if (rows.length > 50_000) throw ApiError.badRequest("单次导入上限 50000 笔");
  for (const [i, r] of rows.entries()) {
    if (r.ticket == null || !/^\d+$/.test(String(r.ticket))) throw ApiError.badRequest(`第 ${i + 1} 行 ticket 非法`);
    if (r.direction !== "buy" && r.direction !== "sell") throw ApiError.badRequest(`第 ${i + 1} 行方向需为 buy/sell`);
    if (!r.openTime || !r.closeTime || Number.isNaN(Date.parse(r.openTime)) || Number.isNaN(Date.parse(r.closeTime)))
      throw ApiError.badRequest(`第 ${i + 1} 行开/平仓时间非法`);
    if (!Number.isFinite(Number(r.lots)) || Number(r.lots) <= 0) throw ApiError.badRequest(`第 ${i + 1} 行手数非法`);
    for (const k of ["profit"] as const) {
      if (!Number.isFinite(Number(r[k]))) throw ApiError.badRequest(`第 ${i + 1} 行 profit 非法`);
    }
  }
}

async function ensureAccount(userId: string, login: string, nickname?: string): Promise<string> {
  const hit = await pool.query(`select id from trade_accounts where user_id = $1 and login = $2`, [userId, login]);
  if (hit.rows[0]) {
    if (nickname) await pool.query(`update trade_accounts set nickname = $1 where id = $2`, [nickname, hit.rows[0].id]);
    return hit.rows[0].id;
  }
  const ins = await pool.query(
    `insert into trade_accounts (user_id, login, nickname) values ($1,$2,$3) returning id`,
    [userId, login, nickname ?? null],
  );
  return ins.rows[0].id;
}

/** FR-1.1/1.2 导入：dryRun 预览去重；commit 建批次 + 批量 insert（ticket 去重） */
export async function importTrades(userId: string, body: ImportBody) {
  validateRows(body.rows);
  const login = String(body.login ?? "").trim();
  if (!login) throw ApiError.badRequest("login 必填");
  if (!["mt5_xlsx", "csv"].includes(body.source)) throw ApiError.badRequest("source 需为 mt5_xlsx/csv");

  const accountId = await ensureAccount(userId, login, body.nickname);
  const tickets = body.rows.map((r) => String(r.ticket));
  const existing = await pool.query(
    `select ticket from trades where user_id = $1 and account_id = $2 and ticket = any($3::bigint[])`,
    [userId, accountId, tickets],
  );
  const dupSet = new Set(existing.rows.map((r) => String(r.ticket)));
  const fresh = body.rows.filter((r) => !dupSet.has(String(r.ticket)));
  const firstAt = fresh.length ? fresh.map((r) => r.closeTime).sort()[0] : null;
  const lastAt = fresh.length ? fresh.map((r) => r.closeTime).sort().at(-1) : null;

  if (body.dryRun) {
    return {
      rowsTotal: body.rows.length,
      rowsNew: fresh.length,
      rowsDup: body.rows.length - fresh.length,
      firstAt,
      lastAt,
      sample: fresh.slice(0, 5).map((r) => ({ ticket: r.ticket, direction: r.direction, lots: r.lots, profit: r.profit, closeTime: r.closeTime })),
    };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const imp = (
      await client.query(
        `insert into trade_imports (user_id, account_id, file_name, source, rows_total, rows_new, rows_dup, first_at, last_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [userId, accountId, body.fileName ?? "import", body.source, body.rows.length, fresh.length, body.rows.length - fresh.length, firstAt, lastAt],
      )
    ).rows[0];
    const CHUNK = 1000;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const vals: unknown[] = [];
      const tuples = chunk.map((r) => {
        vals.push(userId, accountId, imp.id, String(r.ticket), r.symbol ?? "XAUUSD", r.direction, r.openTime, r.closeTime, Number(r.lots), r.openPrice ?? null, r.closePrice ?? null, Number(r.profit ?? 0), Number(r.commission ?? 0), Number(r.swap ?? 0));
        const b = vals.length;
        return `($${b - 13},$${b - 12},$${b - 11},$${b - 10},$${b - 9},$${b - 8},$${b - 7},$${b - 6},$${b - 5},$${b - 4},$${b - 3},$${b - 2},$${b - 1},$${b})`;
      });
      await client.query(
        `insert into trades
           (user_id, account_id, import_id, ticket, symbol, direction, open_time, close_time, lots, open_price, close_price, profit, commission, swap)
         values ${tuples.join(",")}`,
        vals,
      );
    }
    await client.query("commit");
    return {
      account: { id: accountId, login },
      importId: imp.id,
      rowsNew: fresh.length,
      rowsDup: body.rows.length - fresh.length,
    };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** FR-1.3 账号列表 + 汇总 */
export async function listAccounts(userId: string) {
  const { rows } = await pool.query(
    `select a.id, a.login, a.nickname, a.currency,
            count(t.id)::int as trades,
            coalesce(sum(t.lots), 0) as lots,
            coalesce(sum(t.net_profit), 0) as net_profit,
            coalesce(sum(case when t.net_profit > 0 then 1 else 0 end), 0)::int as wins,
            min(t.close_time) as first_close, max(t.close_time) as last_close
     from trade_accounts a left join trades t on t.account_id = a.id
     where a.user_id = $1
     group by a.id
     order by a.created_at asc`,
    [userId],
  );
  return {
    accounts: rows.map((r) => ({
      id: r.id,
      login: r.login,
      nickname: r.nickname,
      currency: r.currency,
      trades: Number(r.trades),
      lots: Number(r.lots),
      netProfit: Number(r.net_profit),
      winRate: Number(r.trades) > 0 ? Math.round((Number(r.wins) / Number(r.trades)) * 100) : null,
      firstClose: r.first_close ? new Date(r.first_close).toISOString() : null,
      lastClose: r.last_close ? new Date(r.last_close).toISOString() : null,
    })),
  };
}

async function assertAccountOwned(userId: string, accountId: string) {
  const hit = await pool.query(`select id, login from trade_accounts where id = $1 and user_id = $2`, [accountId, userId]);
  if (!hit.rows[0]) throw ApiError.notFound("交易账号不存在");
  return hit.rows[0];
}

interface DailyRow {
  ymd: string;
  net: number;
  count: number;
  lots: number;
  winRate: number | null;
  streak: number; // 连赢(>0)/连亏(<0) 天数
  prevNet: number | null; // 上一自然日净盈亏（日环比）
}

/** YYYY-MM-DD 形状 + 真实日历日双重校验（形状校验放行 2024-13-01 → ::date cast 抛 500） */
function assertCalendarDate(label: string, v: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw ApiError.badRequest(`${label} 需为 YYYY-MM-DD`);
  if (!isValidCalendarDate(v)) throw ApiError.badRequest(`${label} 需为真实存在的日期（如 2024-13-01 非法）`);
}

/** FR-1.4 按日聚合（北京时区切日）+ 日环比 + 连赢连亏 */
export async function dailyPnl(userId: string, accountId: string, from: string, to: string) {
  await assertAccountOwned(userId, accountId);
  assertCalendarDate("from/to", from);
  assertCalendarDate("from/to", to);
  const { rows } = await pool.query(
    `select to_char((close_time at time zone $3)::date, 'YYYY-MM-DD') as ymd,
            sum(net_profit) as net, count(*)::int as count, sum(lots) as lots,
            sum(case when net_profit > 0 then 1 else 0 end)::int as wins
     from trades
     where user_id = $1 and account_id = $2
       and (close_time at time zone $3)::date between $4::date and $5::date
     group by 1 order by 1`,
    [userId, accountId, TZ, from, to],
  );
  const days: DailyRow[] = rows.map((r) => ({
    ymd: r.ymd,
    net: Number(r.net),
    count: Number(r.count),
    lots: Number(r.lots),
    winRate: Number(r.count) > 0 ? Math.round((Number(r.wins) / Number(r.count)) * 100) : null,
    streak: 0,
    prevNet: null,
  }));
  // 日环比：上一自然日净盈亏（无记录日为 null）
  const byYmd = new Map(days.map((d) => [d.ymd, d]));
  for (const d of days) {
    const prev = new Date(d.ymd + "T00:00:00Z");
    prev.setUTCDate(prev.getUTCDate() - 1);
    const p = byYmd.get(prev.toISOString().slice(0, 10));
    d.prevNet = p ? p.net : null;
  }
  // 连赢/连亏标记（同号盈亏连续累计）
  let streak = 0;
  let prevSign = 0;
  for (const d of days) {
    const sign = d.net > 0 ? 1 : d.net < 0 ? -1 : 0;
    if (sign !== 0 && sign === prevSign) streak += sign;
    else streak = sign;
    d.streak = streak;
    prevSign = streak === 0 ? prevSign : streak;
  }
  return { days };
}

/** FR-1.5 权益曲线：累计净盈亏 + 峰值 + 回撤段 + 峰值前后两阶段（服务端算好） */
export async function equityCurve(userId: string, accountId: string) {
  await assertAccountOwned(userId, accountId);
  const { rows } = await pool.query(
    `select to_char((close_time at time zone $2)::date, 'YYYY-MM-DD') as ymd,
            sum(net_profit) as net, count(*)::int as count,
            sum(case when net_profit > 0 then 1 else 0 end)::int as wins
     from trades where user_id = $1 and account_id = $3
     group by 1 order by 1`,
    [userId, TZ, accountId],
  );
  const days = rows.map((r) => ({ ymd: r.ymd, net: Number(r.net), count: Number(r.count), wins: Number(r.wins) }));
  let cum = 0;
  let peak = 0;
  let peakYmd: string | null = null;
  const points: Array<{ ymd: string; cum: number }> = [];
  let curDd: { startYmd: string; endYmd: string; troughYmd: string; amount: number } | null = null;
  const drawdowns: Array<{ startYmd: string; endYmd: string; troughYmd: string; amount: number }> = [];
  for (const d of days) {
    cum += d.net;
    points.push({ ymd: d.ymd, cum: Number(cum.toFixed(2)) });
    if (cum >= peak) {
      if (curDd && curDd.amount > 0) drawdowns.push(curDd);
      curDd = null;
      peak = cum;
      peakYmd = d.ymd;
    } else if (peak - cum > 0) {
      if (!curDd) curDd = { startYmd: peakYmd ?? days[0].ymd, endYmd: d.ymd, troughYmd: d.ymd, amount: Number((peak - cum).toFixed(2)) };
      else {
        curDd.endYmd = d.ymd;
        curDd.troughYmd = d.ymd;
        curDd.amount = Number((peak - cum).toFixed(2));
      }
    }
  }
  if (curDd && curDd.amount > 0) drawdowns.push(curDd);
  drawdowns.sort((a, b) => b.amount - a.amount);

  const peakIdx = peakYmd ? days.findIndex((d) => d.ymd === peakYmd) : -1;
  const phaseStat = (list: typeof days) => ({
    count: list.reduce((s, d) => s + d.count, 0),
    net: Number(list.reduce((s, d) => s + d.net, 0).toFixed(2)),
    winRate: list.reduce((s, d) => s + d.count, 0) > 0
      ? Math.round((list.reduce((s, d) => s + d.wins, 0) / list.reduce((s, d) => s + d.count, 0)) * 100)
      : null,
  });
  const phases = {
    beforePeak: phaseStat(peakIdx >= 0 ? days.slice(0, peakIdx + 1) : days),
    afterPeak: phaseStat(peakIdx >= 0 ? days.slice(peakIdx + 1) : []),
  };
  return {
    points,
    totalNet: Number(cum.toFixed(2)),
    peak: peakYmd ? { ymd: peakYmd, cum: Number(peak.toFixed(2)) } : null,
    drawdowns: drawdowns.slice(0, 5),
    phases,
  };
}

const PERIOD_SQL: Record<string, string> = {
  morning: "extract(hour from (close_time at time zone 'Asia/Shanghai')) between 6 and 11",
  afternoon: "extract(hour from (close_time at time zone 'Asia/Shanghai')) between 12 and 17",
  evening: "extract(hour from (close_time at time zone 'Asia/Shanghai')) between 18 and 23",
  lateNight: "extract(hour from (close_time at time zone 'Asia/Shanghai')) < 6",
};
const DUR_SQL: Record<string, string> = {
  lt15m: "extract(epoch from (close_time - open_time)) / 60 < 15",
  m15to60: "extract(epoch from (close_time - open_time)) / 60 between 15 and 60",
  h1to4: "extract(epoch from (close_time - open_time)) / 60 between 60 and 240",
  gt4h: "extract(epoch from (close_time - open_time)) / 60 > 240",
};

/** FR-1.6 逐笔明细：四维归类筛选 + 分页 20/页 */
export async function listTrades(
  userId: string,
  q: { accountId: string; from?: string; to?: string; dir?: string; period?: string; durBand?: string; pnlBand?: string; page?: number },
) {
  await assertAccountOwned(userId, q.accountId);
  const where: string[] = ["user_id = $1", "account_id = $2"];
  const vals: unknown[] = [userId, q.accountId];
  const W = () => `(${where.join(" and ")})`;
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    // 形状合法但非真实日历日（2024-13-01）→ 400，不放行到 ::date cast（曾抛 500）；其余形状静默忽略（兼容空参）
    assertCalendarDate("from", q.from);
    vals.push(q.from);
    where.push(`(close_time at time zone 'Asia/Shanghai')::date >= $${vals.length}::date`);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    assertCalendarDate("to", q.to);
    vals.push(q.to);
    where.push(`(close_time at time zone 'Asia/Shanghai')::date <= $${vals.length}::date`);
  }
  if (q.dir === "buy" || q.dir === "sell") {
    vals.push(q.dir);
    where.push(`direction = $${vals.length}`);
  }
  if (q.period && PERIOD_SQL[q.period]) where.push(PERIOD_SQL[q.period]);
  if (q.durBand && DUR_SQL[q.durBand]) where.push(DUR_SQL[q.durBand]);
  if (q.pnlBand === "win" || q.pnlBand === "loss") {
    where.push(`net_profit ${q.pnlBand === "win" ? ">" : "<"} 0`);
  } else if (q.pnlBand === "bigWin" || q.pnlBand === "bigLoss") {
    // 分位：以该账号 |net| 的 80 分位为大单阈值
    const sign = q.pnlBand === "bigWin" ? ">" : "<";
    where.push(
      `net_profit ${sign} coalesce((select percentile_cont(0.8) within group (order by abs(net_profit)) from trades where ${W()} and sign(net_profit) = ${sign === ">" ? 1 : -1}), 0)`,
    );
  }
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = 20;
  const total = Number(
    (await pool.query(`select count(*)::int as n from trades where ${W()}`, vals)).rows[0].n,
  );
  const { rows } = await pool.query(
    `select id, ticket, symbol, direction, open_time, close_time, lots, open_price, close_price, net_profit
     from trades
     where ${W()}
     order by close_time desc
     limit ${limit} offset ${(page - 1) * limit}`,
    vals,
  );
  return {
    total,
    page,
    pageSize: limit,
    items: rows.map((r) => ({
      id: r.id,
      ticket: String(r.ticket),
      symbol: r.symbol,
      direction: r.direction,
      openTime: new Date(r.open_time).toISOString(),
      closeTime: new Date(r.close_time).toISOString(),
      lots: Number(r.lots),
      openPrice: r.open_price != null ? Number(r.open_price) : null,
      closePrice: r.close_price != null ? Number(r.close_price) : null,
      netProfit: Number(r.net_profit),
      holdMinutes: Math.round((new Date(r.close_time).getTime() - new Date(r.open_time).getTime()) / 60_000),
    })),
  };
}
