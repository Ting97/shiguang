/** fitness 页公共构件（REQ-016）：单位换算/展示格式/状态元数据 */
import { bjMondayOf } from "@shiguangri/shared/date";
import type {
  FitnessBodyMetric,
  FitnessExercise,
  FitnessGoal,
  FitnessModule,
  FitnessPlan,
  FitnessPlanContent,
  FitnessProfile,
  FitnessSessionLog,
  RunPlanContent,
  StrengthPlanContent,
} from "@shiguangri/shared/fitness-types";

export type {
  FitnessBodyMetric,
  FitnessExercise,
  FitnessGoal,
  FitnessModule,
  FitnessPlan,
  FitnessPlanContent,
  FitnessProfile,
  FitnessSessionLog,
  RunPlanContent,
  StrengthPlanContent,
};

/** 克 → "68.4" kg 展示 */
export const kg = (g?: number | null, suffix = "kg") => (g != null ? `${Math.round(g / 100) / 10}${suffix}` : "—");
/** 毫米 → "88.0" cm 展示（mm→cm 只除一次 10；曾误写成两次 ÷10 导致 88cm 显示 8.8） */
export const cm = (mm?: number | null) => (mm != null ? `${Math.round(mm) / 10}` : "—");
/** 米 → "8.2km" 展示 */
export const km = (m?: number | null) => (m != null ? `${Math.round(m / 100) / 10}km` : "—");
/** 秒每公里 → "5'50\"" 展示 */
export const pace = (sPerKm?: number | null) => {
  if (sPerKm == null) return "—";
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
};
/** 小时×10 → "6.5h" 展示（一位小数；旧版 Math.round(x/10)/1 会把 6.5 吞成 7） */
export const hours = (x10?: number | null) => (x10 != null ? `${Math.round(x10) / 10}h` : "—");

export const RUN_WORKOUT_LABELS: Record<RunPlanContent["workoutType"], string> = {
  interval: "间歇",
  tempo: "节奏",
  long: "长距离",
  easy: "轻松",
  recovery: "恢复",
};

export const PLAN_STATUS_META: Record<FitnessPlan["status"], { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  confirmed: { label: "已确认", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  done: { label: "已完成", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  partial: { label: "部分完成", cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  skipped: { label: "已跳过", cls: "bg-wash text-ink-mute" },
};

/** 计划主标题（跑步含课型与总量；力量为 content.title） */
export function planTitle(plan: FitnessPlan): string {
  const c = plan.content as RunPlanContent & StrengthPlanContent;
  if (plan.module_code === "run") {
    const label = RUN_WORKOUT_LABELS[(c as RunPlanContent).workoutType] ?? "跑步";
    return `${label} · ${c.title}`;
  }
  return c.title ?? "力量课";
}

/** 按日期组织计划（含跨周分组用的周一键——北京时区口径走 shared 的 bjMondayOf） */
export function groupByWeek(plans: FitnessPlan[]): Array<{ monday: string; items: FitnessPlan[] }> {
  const map = new Map<string, FitnessPlan[]>();
  for (const p of plans) {
    const mon = bjMondayOf(p.plan_date);
    if (!map.has(mon)) map.set(mon, []);
    map.get(mon)!.push(p);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([monday, items]) => ({ monday, items }));
}

/** 动作条目找动作库收益（exerciseId 优先，名称兜底） */
export function exerciseMeta(
  e: { exerciseId?: string | null; name: string },
  catalog: FitnessExercise[],
): FitnessExercise | undefined {
  if (e.exerciseId) {
    const hit = catalog.find((c) => c.id === e.exerciseId);
    if (hit) return hit;
  }
  const name = e.name.trim();
  return (
    catalog.find((c) => c.name === name) ??
    catalog.find((c) => c.name.includes(name) || name.includes(c.name))
  );
}

/** MM-DD 展示 */
export const mdLabel = (dateStr: string) => dateStr.slice(5).replace("-", "/");
