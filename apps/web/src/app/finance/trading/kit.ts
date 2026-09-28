/**
 * 交易页共享类型与工具（REQ-005 R1）。
 * 金额口径：USD 数值（非分），展示统一 $ 前缀 + 两位小数。
 * 时间展示：北京时间一律 UTC getter + 8h（AGENTS 约定，禁本地 getter）。
 */

export interface TradingAccount {
  id: string;
  login: string;
  nickname: string | null;
  currency: string;
  source?: "mt5" | "bitget"; // 041：账户来源（Bitget CFD 同步落 bitget）
  trades: number;
  lots: number;
  netProfit: number;
  winRate: number | null;
  firstClose: string | null;
  lastClose: string | null;
}

export interface DryRunPreview {
  rowsTotal: number;
  rowsNew: number;
  rowsDup: number;
  firstAt: string | null;
  lastAt: string | null;
  sample: { ticket: string; direction: string; lots: number; profit: number; closeTime: string }[];
}

export interface ImportCommit {
  account: { id: string; login: string };
  importId: string;
  rowsNew: number;
  rowsDup: number;
}

export interface DailyDay {
  ymd: string;
  net: number;
  count: number;
  lots: number;
  winRate: number | null;
  streak: number; // 连赢(>0)/连亏(<0)
  prevNet: number | null;
}

/** 周聚合视图行（Monday 起始，key=该周周一的 YYYY-MM-DD） */
export interface WeekDay {
  weekStart: string;
  weekEnd: string;
  net: number;
  count: number;
  lots: number;
  upDays: number; // 周内净盈利天数
  days: number; // 周内有交易天数
}

/** 北京日历日 → 所属周一（ISO 周，Monday 起始）的 YYYY-MM-DD */
export function mondayOf(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=周日
  const shift = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/** 日序列 → 周序列（净盈亏/笔数/手数累加；周胜率列以「盈利天数」近似呈现） */
export function groupByWeek(days: DailyDay[]): WeekDay[] {
  const map = new Map<string, WeekDay>();
  for (const d of days) {
    const key = mondayOf(d.ymd);
    let w = map.get(key);
    if (!w) {
      const end = new Date(key + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 6);
      w = { weekStart: key, weekEnd: end.toISOString().slice(0, 10), net: 0, count: 0, lots: 0, upDays: 0, days: 0 };
      map.set(key, w);
    }
    w.net += d.net;
    w.count += d.count;
    w.lots += d.lots;
    w.days += 1;
    if (d.net > 0) w.upDays += 1;
  }
  return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface PhaseStat {
  count: number;
  net: number;
  winRate: number | null;
}

export interface DrawdownSeg {
  startYmd: string;
  endYmd: string;
  troughYmd: string;
  amount: number;
}

export interface EquityPoint {
  ymd: string;
  cum: number;
}

export interface EquityData {
  points: EquityPoint[];
  totalNet: number;
  peak: EquityPoint | null;
  drawdowns: DrawdownSeg[];
  phases: { beforePeak: PhaseStat; afterPeak: PhaseStat };
}

export interface TradeItem {
  id: string;
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  openTime: string;
  closeTime: string;
  lots: number;
  openPrice: number | null;
  closePrice: number | null;
  netProfit: number;
  holdMinutes: number;
}

export interface TradesPage {
  total: number;
  page: number;
  pageSize: number;
  items: TradeItem[];
}

export interface DigestBucket {
  bucket: string;
  count: number;
  net: number;
}

export interface NotableTrade {
  label: string;
  ticket: string;
  symbol: string;
  direction: "buy" | "sell";
  lots: number;
  netProfit: number;
  closeTime: string;
}

export interface Digest {
  accountId: string;
  stats: {
    totalTrades: number;
    totalNet: number;
    peak: EquityPoint | null;
    drawdowns: DrawdownSeg[];
    phases: { beforePeak: PhaseStat; afterPeak: PhaseStat };
  };
  aggregations: { byPeriod: DigestBucket[]; byDuration: DigestBucket[]; byDirection: DigestBucket[] };
  notable: NotableTrade[];
  facts: string;
}

export interface TradingReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/** AI 复盘态：ai=LLM 版（缓存秒显）；fallback=规则版 digest +「已降级」徽标 */
export type ReviewState =
  | { kind: "ai"; review: TradingReview; cached: boolean; generatedAt: string }
  | { kind: "fallback"; reason: string; digest: Digest | null }
  | null;

/* ---------- 展示工具 ---------- */

/** 金额展示：$ 前缀 + 两位小数（负号在最前） */
export function fmtUsd(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const pnlColor = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-ink-dim");

export function bjToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** ISO → 北京日期 YYYY/M/D */
export function bjDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** ISO → 北京时间 M/D HH:mm */
export function bjTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 持仓时长文案：45分 / 2时10分 / 1天3时 */
export function fmtHold(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}时${minutes % 60 ? `${minutes % 60}分` : ""}`;
  return `${Math.floor(minutes / 1440)}天${Math.round((minutes % 1440) / 60)}时`;
}

/** 归类 bucket 文案（与服务端 SQL 分桶一致） */
export const BUCKET_LABEL: Record<string, string> = {
  morning: "早晨(6-12点)",
  afternoon: "午后(12-18点)",
  evening: "晚间(18-24点)",
  lateNight: "深夜(0-6点)",
  lt15m: "<15分钟",
  m15to60: "15-60分钟",
  h1to4: "1-4小时",
  gt4h: ">4小时",
  buy: "买入",
  sell: "卖出",
};
