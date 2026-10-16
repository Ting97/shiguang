/* —— 健身模块（REQ-016）：行结构与计划 content 契约（蛇形字段与 SQL 列对齐） —— */

/** 训练模块目录行 */
export interface FitnessModule {
  code: string;
  name: string;
  icon: string;
  sort: number;
  is_active: boolean;
}

/** 基本情况档案行 */
export interface FitnessProfile {
  user_id: string;
  height_cm: number | null;
  baseline: Record<string, unknown>;
  experience: string | null;
  equipment: string[];
  weekly_days: string | null;
  constraints: string | null;
  created_at: string;
  updated_at: string;
}

/** 目标行（strategy：阶段/周模板/调整协议/饮食——AI 编排依据） */
export interface FitnessGoal {
  id: string;
  user_id: string;
  module_code: string;
  title: string;
  target_date: string | null;
  status: "active" | "achieved" | "archived";
  targets: Record<string, unknown>;
  baseline: Record<string, unknown>;
  strategy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** 跑步计划分段（整数口径：米 / 秒每公里；durationMin=佳明时间驱动课分段分钟，hrBpmText=bpm 区间原文） */
export interface RunSegment {
  label: string;
  distanceM?: number | null;
  durationMin?: number | null;
  paceSPerKm?: number | null;
  hrZone?: number | null;
  hrBpmText?: string | null;
  reps?: number | null;
  note?: string | null;
}

/** 跑步计划 content */
export interface RunPlanContent {
  workoutType: "interval" | "tempo" | "long" | "easy" | "recovery";
  title: string;
  segments: RunSegment[];
  totalDistanceM?: number | null;
  durationMin?: number | null;
  note?: string | null;
}

/** 力量计划动作条目（weightG=克；repsText 保真 "10-12"/"45s"） */
export interface StrengthExerciseItem {
  exerciseId?: string | null;
  name: string;
  sets?: number | null;
  repsText?: string | null;
  weightG?: number | null;
  rir?: number | null;
  note?: string | null;
}

/** 力量计划 content */
export interface StrengthPlanContent {
  title: string;
  exercises: StrengthExerciseItem[];
  /** 课表总时长（佳明截图概述，分钟） */
  durationMin?: number | null;
  note?: string | null;
}

export type FitnessPlanContent = RunPlanContent | StrengthPlanContent;

/** 每日计划行 */
export interface FitnessPlan {
  id: string;
  user_id: string;
  plan_date: string; // YYYY-MM-DD（北京）
  module_code: string;
  module_name?: string;
  module_icon?: string;
  source: "ai" | "import" | "manual";
  status: "draft" | "confirmed" | "done" | "partial" | "skipped";
  content: FitnessPlanContent;
  rationale: string | null;
  origin_conversation_id: string | null;
  /** 训记同步状态（REQ-017）：{localids:string[], syncedAt:string}；null=未同步过 */
  xunji_sync?: { localids?: string[]; syncedAt?: string } | null;
  created_at: string;
  updated_at: string;
}

/** 执行记录行 */
export interface FitnessSessionLog {
  id: string;
  user_id: string;
  log_date: string;
  module_code: string;
  plan_id: string | null;
  actual: {
    distanceM?: number | null;
    durationS?: number | null;
    paceSPerKm?: number | null;
    avgHr?: number | null;
    exercises?: { name: string; sets?: number | null; repsText?: string | null; weightG?: number | null }[];
  };
  fatigue: number | null;
  sleep_h_x10: number | null;
  soreness: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 身体指标行（周一晨起空腹口径；身高 019 起随日记录） */
export interface FitnessBodyMetric {
  id: string;
  user_id: string;
  measured_on: string;
  weight_g: number | null;
  waist_mm: number | null;
  body_fat_pct_x10: number | null;
  height_mm: number | null;
  resting_hr: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 动作库行（benefit=练什么对哪里有好处） */
export interface FitnessExercise {
  id: string;
  module_code: string;
  name: string;
  muscle_primary: string[];
  muscle_secondary: string[];
  equipment: string | null;
  level: "beginner" | "intermediate" | "advanced";
  benefit: string;
  default_template: { sets?: number; reps?: string; rir?: number; durationMin?: number };
  sort: number;
}

/** 助手操作确认卡（REQ-016 A.5 首发落地） */
export interface ChatProposal {
  id: string;
  conversation_id: string | null;
  kind: "fitness_plan";
  /** fitness_plan 载荷：直接可 POST /api/fitness/plans 的 body（整数口径） */
  payload: {
    planDate: string;
    moduleCode: "run" | "strength";
    content: FitnessPlanContent;
    rationale?: string | null;
  };
  status: "pending" | "accepted" | "dismissed";
  created_at: string;
}
