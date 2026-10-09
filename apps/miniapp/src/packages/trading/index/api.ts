/**
 * 交易页局部端点与类型（= web app/finance/trading/kit.ts 的小程序版）。
 * lib/api.ts 的 loadTrading* 系列类型是 any/旧口径（如 loadTradingTrades 写 {trades} 实际返回 {items}），
 * 本页按服务端真实结构就地重声明；digest 与 POST 生成复盘 lib 缺失，局部补齐。
 * 契约 grep apps/api/src/app/api/trading/** 与 apps/api/src/server/finance/trading/trades-review.ts 确认。
 * 注意：交易金额是 USD 原币数值（不是分），展示用 usd() 而非 yuan()。
 */
import { request } from "@/lib/request";

/* ---------- 类型（= web trading/kit.ts） ---------- */

export interface TradingAccount {
  id: string;
  login: string;
  nickname: string | null;
  currency: string;
  source?: "mt5" | "bitget";
  trades: number;
  lots: number;
  netProfit: number;
  winRate: number | null;
  firstClose: string | null;
  lastClose: string | null;
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
/** 周聚合视图行（Monday 起始） */
export interface WeekDay {
  weekStart: string;
  weekEnd: string;
  net: number;
  count: number;
  lots: number;
  upDays: number; // 周内净盈利天数
  days: number; // 周内有交易天数
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
  phases: { beforePeak: { count: number; net: number; winRate: number | null }; afterPeak: { count: number; net: number; winRate: number | null } };
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
export interface Digest {
  accountId: string;
  stats: {
    totalTrades: number;
    totalNet: number;
    peak: EquityPoint | null;
    drawdowns: DrawdownSeg[];
    phases: {
      beforePeak: { count: number; net: number; winRate: number | null };
      afterPeak: { count: number; net: number; winRate: number | null };
    };
  };
  aggregations: { byPeriod: DigestBucket[]; byDuration: DigestBucket[]; byDirection: DigestBucket[] };
  notable: { label: string; ticket: string; symbol: string; direction: string; lots: number; netProfit: number; closeTime: string }[];
  facts: string;
}

export interface TradingReviewBody {
  summary: string;
  highlights: string[];
  suggestions: string[];
}
/** AI 复盘生成响应：正常 {review,...}；降级 {fallback:true, fallbackReason, digest}（402/429/上游挂时服务端规则版兜底） */
export interface ReviewGenResp {
  review?: TradingReviewBody;
  cached?: boolean;
  generatedAt?: string;
  fallback?: boolean;
  fallbackReason?: string;
  digest?: Digest | null;
}

/* ---------- 端点 ---------- */

export function loadAccounts() {
  return request<{ accounts: TradingAccount[] }>("/api/trading/accounts");
}
export function loadDaily(accountId: string, from: string, to: string) {
  return request<{ days: DailyDay[] }>(`/api/trading/daily?accountId=${accountId}&from=${from}&to=${to}`);
}
export function loadEquity(accountId: string) {
  return request<EquityData>(`/api/trading/equity?accountId=${accountId}`);
}
/** 逐笔明细：归类筛选（dir/period/durBand/pnlBand）+ 分页 20/页 */
export function loadTrades(accountId: string, filters: Record<string, string>, page: number) {
  const sp = new URLSearchParams({ accountId, ...filters, page: String(page) });
  return request<TradesPage>(`/api/trading/trades?${sp.toString()}`);
}
/** GET digest —— 规则统计素材（零 LLM，页面常显） */
export function loadDigest(accountId: string) {
  return request<Digest>(`/api/trading/digest?accountId=${accountId}`);
}
/** GET 复盘缓存（不耗配额；无缓存 {review:null}） */
export function getReviewCache(accountId: string) {
  return request<{ review: TradingReviewBody | null; cached?: boolean; generatedAt?: string }>(`/api/trading/review?accountId=${accountId}`);
}
/** POST 生成 AI 复盘 {accountId, refresh} */
export function genReview(accountId: string, refresh = true) {
  return request<ReviewGenResp>("/api/trading/review", {
    method: "POST",
    body: { accountId, refresh },
    timeout: 60000, // LLM 同步生成耗时长：突破全局 20s 默认超时
  });
}
/** 一键同步前置：已绑定密钥列表 */
export function loadBitgetKeys() {
  return request<{ bound: boolean; keys?: { label: string }[] }>("/api/trading/bitget/keys");
}
/** 对单把密钥做增量同步（from 缺省=最后平仓日-1 天，服务端只翻几页即停避开限频） */
export function syncBitget(label: string) {
  return request<{ rowsNew: number; rowsDup: number; fromUsed: string; toUsed: string }>("/api/trading/bitget/sync", {
    method: "POST",
    body: { keyLabel: label, dryRun: false },
  });
}

/* ---------- 展示工具（= web trading/kit.ts） ---------- */

/** USD 金额：$ 前缀 + 两位小数（负号在最前）；MT5/Bitget 金额非分，禁用 yuan() */
export function fmtUsd(n: number): string {
  const v = Number(n) || 0;
  // 不用 toLocaleString：iOS JavaScriptCore 无 Intl 时退化为无千分位（三端展示不一致）
  const [int, frac] = Math.abs(v).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${v < 0 ? "-" : ""}$${grouped}.${frac}`;
}
/** 盈亏着色：正 success / 负 danger / 零 dim */
export const pnlTone = (n: number) => (n > 0 ? "money-in" : n < 0 ? "money-out" : "dim");

/** 北京今天 YYYY-MM-DD / UTC 口径日推进（REQ-009 9-C 单源：= shared bjToday/bjAddDays 的页面旧名） */
export { bjToday as bjTodayStr, bjAddDays as addDays } from "@shiguangri/shared";
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
/** 北京日历日 → 所属周一（ISO 周，Monday 起始） */
export function mondayOf(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  const shift = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
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
/** 北京当月/上月 YYYY-MM-DD 边界 */
export function bjMonthRange(offset: number): [string, string] {
  const now = new Date(Date.now() + 8 * 3600_000);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}
/** 归类 bucket 文案（与服务端 SQL 分桶一致；= web BUCKET_LABEL） */
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
