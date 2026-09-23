/**
 * 负债策略模拟（REQ-003 3-F FR-C2.6）—— 纯函数，无 IO。
 * 简化模型：按月复利、各笔月供固定、额外还款额固定，不计提前还款违约金/利率变动。
 * 月内顺序：计息 → 先按各笔最低月供扣款 → 剩余预算按策略顺序（雪球=余额升序 / 雪崩=利率降序）逐笔清偿。
 */
export interface SimDebt {
  id: string;
  name: string;
  balanceCents: number;
  ratePct: number;
  monthlyCents: number | null;
}

export interface SimMonthRow {
  month: string; // YYYY-MM
  paidCents: number;
  interestCents: number;
  balanceCents: number; // 当月末剩余
}

export interface SimResult {
  strategy: "snowball" | "avalanche" | "baseline";
  order: string[]; // 清偿顺序（负债名）
  months: number | null; // 清零所需月数；超上限未清零为 null
  clearedLabel: string | null;
  totalInterestCents: number;
  totalPaidCents: number;
  schedule: SimMonthRow[]; // 最多 36 行（超长抽样：等距取点 + 末月）
  notCleared: boolean;
}

const MAX_MONTHS = 600;

/** YYYY-MM 加 n 个月 */
function monthLabel(base: string, add: number): string {
  const [y, m] = base.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + add;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function simulateStrategy(
  input: SimDebt[],
  extraCents: number,
  strategy: SimResult["strategy"],
  startMonth: string,
): SimResult {
  const debts = input
    .filter((d) => d.balanceCents > 0)
    .map((d) => ({ ...d, bal: d.balanceCents }));
  const sortFn =
    strategy === "avalanche"
      ? (a: (typeof debts)[0], b: (typeof debts)[0]) => b.ratePct - a.ratePct || a.bal - b.bal
      : (a: (typeof debts)[0], b: (typeof debts)[0]) => a.bal - b.bal || b.ratePct - a.ratePct;
  const order = [...debts].sort(sortFn).map((d) => d.name);

  const schedule: SimMonthRow[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;

  while (debts.some((d) => d.bal > 0) && months < MAX_MONTHS) {
    months += 1;
    let interest = 0;
    let paid = 0;
    for (const d of debts) {
      if (d.bal <= 0) continue;
      const i = Math.round((d.bal * d.ratePct) / 1200);
      d.bal += i;
      interest += i;
    }
    // 先扣最低月供（亲友借款无月供 = 0）
    let budget = extraCents;
    for (const d of debts) {
      if (d.bal <= 0) continue;
      const min = Math.min(d.monthlyCents ?? 0, d.bal);
      d.bal -= min;
      paid += min;
    }
    // 剩余预算（extra）按策略顺序清偿
    for (const d of [...debts].sort(sortFn)) {
      if (d.bal <= 0 || budget <= 0) continue;
      const pay = Math.min(budget, d.bal);
      d.bal -= pay;
      budget -= pay;
      paid += pay;
    }
    totalInterest += interest;
    totalPaid += paid;
    const remaining = debts.reduce((s, d) => s + d.bal, 0);
    pushRow(schedule, {
      month: monthLabel(startMonth, months - 1),
      paidCents: paid,
      interestCents: interest,
      balanceCents: remaining,
    });
    if (remaining <= 0) break;
  }

  const cleared = !debts.some((d) => d.bal > 0);
  return {
    strategy,
    order,
    // 输入全为零余额时循环一次未跑：months=0 的语义是「已清偿」，清偿月=起始月而非上月（monthLabel(-1) 的边界）
    months: cleared ? months : null,
    clearedLabel: cleared ? (months > 0 ? monthLabel(startMonth, months - 1) : monthLabel(startMonth, 0)) : null,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    schedule: sampleSchedule(schedule),
    notCleared: !cleared,
  };
}

function pushRow(rows: SimMonthRow[], row: SimMonthRow) {
  rows.push(row);
}

/** 逐月表压缩到 ≤36 行：前 12 月全量 + 等距抽样 + 末月，保证首尾完整 */
function sampleSchedule(rows: SimMonthRow[]): SimMonthRow[] {
  if (rows.length <= 36) return rows;
  const last = rows[rows.length - 1];
  const head = rows.slice(0, 12);
  const rest = rows.slice(12, rows.length - 1);
  const step = Math.max(1, Math.ceil(rest.length / 23));
  const sampled = rest.filter((_, i) => i % step === 0);
  const out = [...head, ...sampled];
  if (out[out.length - 1].month !== last.month) out.push(last);
  return out;
}
