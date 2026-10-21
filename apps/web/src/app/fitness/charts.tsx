"use client";

/**
 * fitness 趋势图（REQ-016 FR-G）：全部手写 SVG，零新依赖。
 * 折线仿 finance SavingsTrend（viewBox 拉伸 + non-scaling-stroke + 峰值标点）；
 * 热力格仿日历年视图 --heat-* 色阶。体重 g / 腰围 mm / 配速 s 每 km 均为整数口径入参。
 */
import type { FitnessBodyMetric, FitnessPlan } from "@shiguangri/shared/fitness-types";
import { bjMondayOf } from "@shiguangri/shared/date";
import { km, mdLabel, pace as fmtPace } from "./kit";

/** 迷你折线：值域自适应 + 首末点数值标注；空数据给占位文案 */
function LineChart({
  points,
  unit,
  invert = false,
  hint,
}: {
  points: { date: string; value: number }[];
  unit: string;
  /** y 轴反置（配速越低越好） */
  invert?: boolean;
  hint?: string;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-ink-mute">
        {hint ?? "数据不足两条，暂不出图"}
      </div>
    );
  }
  const W = 320;
  const H = 120;
  const PAD = 4;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  // 配速反置：值越小 y 越靠下（视觉「高」=好）
  const y = (v: number) => {
    const t = (v - min) / span;
    return PAD + (invert ? t : 1 - t) * (H - PAD * 2);
  };
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const fmt = (v: number) => (unit === '"' ? fmtPace(v) : `${Math.round(v * 10) / 10}${unit}`);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="none" role="img">
        <path d={area} fill="currentColor" className="text-sky-500/10" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-sky-500" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" fill="currentColor" className="text-sky-500" />
      </svg>
      <span className="absolute left-1 top-0 text-[10px] text-ink-mute">{fmt(first.value)}</span>
      <span className="absolute right-1 top-0 text-[10px] font-medium text-sky-600 dark:text-sky-400">{fmt(last.value)}</span>
      <div className="mt-1 flex justify-between text-[10px] text-ink-mute">
        <span>{mdLabel(first.date)}</span>
        <span>{mdLabel(last.date)}</span>
      </div>
    </div>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {sub ? <p className="mb-2 text-xs text-ink-mute">{sub}</p> : null}
      {children}
    </section>
  );
}

/** 训练热力格：最近 nWeeks 周 × 7 天，完成=深、有计划=浅、无=最浅（--heat-* 色阶） */
function HeatGrid({ plans, today }: { plans: FitnessPlan[]; today: string }) {
  const nWeeks = 12;
  // 周一锚点走 shared 北京时区口径
  const thisMonday = bjMondayOf(today);
  const startMonday = new Date(new Date(`${thisMonday}T00:00:00+08:00`).getTime() - (nWeeks - 1) * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const levelOf = (dateStr: string): number => {
    const dayPlans = plans.filter((p) => p.plan_date === dateStr);
    if (!dayPlans.length) return 0;
    if (dayPlans.some((p) => p.status === "done")) return 4;
    if (dayPlans.some((p) => p.status === "partial")) return 3;
    if (dayPlans.some((p) => p.status === "confirmed")) return 2;
    return 1;
  };

  const cells: { date: string; level: number }[] = [];
  for (let w = 0; w < nWeeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dateStr = new Date(new Date(`${startMonday}T00:00:00+08:00`).getTime() + (w * 7 + d) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (dateStr > today) break;
      cells.push({ date: dateStr, level: levelOf(dateStr) });
    }
  }

  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1 scrollbar-none" aria-label="训练热力图">
      {Array.from({ length: nWeeks }, (_, w) => (
        <div key={w} className="flex flex-col gap-[3px]">
          {cells.slice(w * 7, w * 7 + 7).map((c) => (
            <span
              key={c.date}
              title={`${c.date} · ${["无计划", "草稿", "已确认", "部分完成", "已完成"][c.level]}`}
              className="h-3.5 w-3.5 rounded-[4px]"
              style={{ backgroundColor: `var(--heat-${c.level})` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 趋势 tab 主体 */
export default function FitnessTrends({
  metrics,
  plans,
  logs = [],
  sleep,
  today,
}: {
  metrics: FitnessBodyMetric[];
  plans: FitnessPlan[];
  /** 打卡执行记录：配速/跑量优先取实际（actual），缺失才回退计划口径 */
  logs?: { plan_id: string | null; actual: { distanceM?: number | null; paceSPerKm?: number | null } }[];
  sleep?: { log_date: string; hours: number }[];
  today: string;
}) {
  const weightPts = metrics.filter((m) => m.weight_g != null).map((m) => ({ date: m.measured_on, value: m.weight_g! / 1000 }));
  const waistPts = metrics.filter((m) => m.waist_mm != null).map((m) => ({ date: m.measured_on, value: m.waist_mm! / 10 }));
  const heightPts = metrics.filter((m) => m.height_mm != null).map((m) => ({ date: m.measured_on, value: m.height_mm! / 10 }));
  const bodyFatPts = metrics.filter((m) => m.body_fat_pct_x10 != null).map((m) => ({ date: m.measured_on, value: m.body_fat_pct_x10! / 10 }));
  const sleepPts = (sleep ?? []).map((s) => ({ date: s.log_date, value: s.hours }));
  // logs 按新→旧排序：first-wins 保留同一计划最新一条实绩（后写覆盖会取到最旧，
  // 与 PlanCard 的 logs.find（取最新）两处展示打架——十一轮修正）
  const logByPlan = new Map<string, (typeof logs)[number]>();
  for (const l of logs) if (l.plan_id && !logByPlan.has(l.plan_id)) logByPlan.set(l.plan_id, l);
  const pacePts = plans
    .filter((p) => p.status === "done" && p.module_code === "run")
    .map((p) => {
      // 打卡实际配速优先（趋势的意义是真实表现）；无实绩回退计划分段均值（历史数据兼容）
      const actualPace = logByPlan.get(p.id)?.actual?.paceSPerKm;
      if (actualPace != null) return { date: p.plan_date, value: actualPace };
      const seg = (p.content as { segments?: { paceSPerKm?: number | null }[] }).segments ?? [];
      const paces = seg.map((s) => s.paceSPerKm).filter((v): v is number => v != null);
      const avg = paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null;
      return avg != null ? { date: p.plan_date, value: avg } : null;
    })
    .filter((p): p is { date: string; value: number } => p != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const runDone = plans.filter((p) => p.module_code === "run" && p.status === "done");
  // 实际跑量优先（「已完成跑步课合计」= 真实跑过的距离，米口径），无实绩回退计划距离
  const totalKm = runDone.reduce((sum, p) => {
    const actual = logByPlan.get(p.id)?.actual?.distanceM;
    return sum + (actual != null ? actual : ((p.content as { totalDistanceM?: number | null }).totalDistanceM ?? 0));
  }, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ChartCard title="体重趋势" sub="每周一晨起空腹口径（kg）">
          <LineChart points={weightPts} unit="kg" />
        </ChartCard>
        <ChartCard title="腰围趋势" sub="肚脐水平（cm）">
          <LineChart points={waistPts} unit="cm" />
        </ChartCard>
        <ChartCard title="体脂率趋势" sub="体成分秤/估算口径（%），越低越精瘦">
          <LineChart points={bodyFatPts} unit="%" />
        </ChartCard>
        <ChartCard title="身高趋势" sub="变化缓慢，仅记录生长/测量差异（cm）">
          <LineChart points={heightPts} unit="cm" />
        </ChartCard>
        <ChartCard title="跑步配速趋势" sub="已完成跑步课的平均配速，越低越好">
          <LineChart points={pacePts} unit={'"'} invert />
        </ChartCard>
        {sleepPts.length ? (
          <ChartCard title="睡眠趋势" sub="每日独立记录（小时）；教练参考它执行「睡眠<6h 降级」协议">
            <LineChart points={sleepPts} unit="h" />
          </ChartCard>
        ) : null}
        <ChartCard title="区间跑量" sub="列表范围内已完成跑步课合计">
          <p className="text-2xl font-semibold text-gradient">{km(totalKm)}</p>
          <p className="mt-1 text-xs text-ink-mute">{runDone.length} 次已完成跑步课</p>
        </ChartCard>
      </div>
      <ChartCard title="训练热力" sub="最近 12 周：深=已完成，中=已确认，浅=草稿">
        <HeatGrid plans={plans} today={today} />
      </ChartCard>
    </div>
  );
}
