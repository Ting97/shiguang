/**
 * fitness 域 service（REQ-016）：手写校验 + ApiError + 编排 repo。
 * 计划为中心：POST /plans = 新增草稿（REQ-021：一天同模块可多条并存）；DELETE /plans/[id] 删除（行动级联清理）；
 * 计划落库即联动今日行动（syncPlanTodos 单一规则：计划存在且未 skipped → 行动与计划同步）；
 * 打卡 done/partial 落执行记录并把联动行动置完成。
 * AI：POST /plans/parse 粘贴文本或佳明截图 → FitnessPlanDraftV2（GLM + 一次修复重问）→ 整数口径草稿（不入库）。
 */
import { z } from "zod";
import { ApiError } from "../platform/http/errors";
import { isValidCalendarDate } from "../platform/http/datetime";
import { isUuid } from "../platform/http/validate";
import {
  chat,
  extractJson,
  GlmError,
  activeModel,
  activeVisionModel,
  FitnessPlanDraftV2,
  buildRepairUserPrompt,
  XunjiNameMatchResult,
  type ChatImage,
  type FitnessPlanDraft,
} from "@shiguangri/ai";
import { assembleUserPrompt, getPromptBundle, writeAuditRecord } from "@/server/ai";
import { loadConfig } from "../platform/config";
import { fitnessRepo } from "./repo";
import {
  catalogToNameSet,
  fetchCatalogMovements,
  makeLocalResolver,
  planToTrain,
  readTrains,
  renameExercisesToOfficial,
  ruleMatchOfficialNames,
  splitOfficialNames,
  trainsToRunActual,
  trainsToStrengthActual,
  upsertTrains,
  type FetchLike as XunjiFetchLike,
  type XunjiCatalogMovement,
} from "./xunji";

// ---- 日期与区间守卫 ----

/** 北京日期串校验（合法日历日 + 不早于 2020） */
const bjDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期须为 YYYY-MM-DD")
  .refine((s) => isValidCalendarDate(s) && s >= "2020-01-01", { message: "日期不合法" });

function rangeGuard(from: string, to: string) {
  const f = parseBody(bjDate, from);
  const t = parseBody(bjDate, to);
  if (f > t) throw ApiError.badRequest("开始日期晚于结束日期");
  if (new Date(`${t}T00:00:00+08:00`).getTime() - new Date(`${f}T00:00:00+08:00`).getTime() > 366 * 86_400_000) {
    throw ApiError.badRequest("查询区间不能超过一年");
  }
  return [f, t] as const;
}

/** zod 校验失败统一 400（裸 .parse 的 ZodError 会被基座当 500） */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw ApiError.badRequest(`入参不合法：${(issue.path.join(".") || "(root)") + " " + issue.message}`.slice(0, 200));
  }
  return parsed.data;
}

// ---- 计划 content 契约（整数口径；入库与前端共用） ----

export const RunPlanContentSchema = z.object({
  workoutType: z.enum(["interval", "tempo", "long", "easy", "recovery"]),
  title: z.string().min(1).max(30),
  segments: z
    .array(
      z.object({
        label: z.string().min(1).max(20),
        distanceM: z.number().int().positive().max(300_000).nullable().optional(),
        /** 分段时长（分钟，佳明时间驱动课步骤）；与 distanceM 二选一 */
        durationMin: z.number().min(0.5).max(300).nullable().optional(),
        paceSPerKm: z.number().int().positive().max(1200).nullable().optional(),
        hrZone: z.number().int().min(1).max(5).nullable().optional(),
        /** 强度目标 bpm 区间原文（如 "134-161"，佳明截图）；不折算 hrZone */
        hrBpmText: z.string().max(20).nullable().optional(),
        reps: z.number().int().min(2).max(40).nullable().optional(),
        note: z.string().max(60).nullable().optional(),
      }),
    )
    .max(12)
    .default([]),
  totalDistanceM: z.number().int().positive().max(300_000).nullable().optional(),
  durationMin: z.number().int().min(5).max(600).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

export const StrengthPlanContentSchema = z.object({
  title: z.string().min(1).max(30),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().max(40).nullable().optional(),
        name: z.string().min(1).max(20),
        sets: z.number().int().min(1).max(10).nullable().optional(),
        repsText: z.string().max(12).nullable().optional(),
        weightG: z.number().int().min(0).max(500_000).nullable().optional(),
        rir: z.number().int().min(0).max(10).nullable().optional(),
        note: z.string().max(60).nullable().optional(),
      }),
    )
    .min(1)
    .max(15),
  /** 课表总时长（佳明截图概述「总时长」，分钟） */
  durationMin: z.number().int().min(5).max(600).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

export type RunPlanContent = z.infer<typeof RunPlanContentSchema>;
export type StrengthPlanContent = z.infer<typeof StrengthPlanContentSchema>;

/** 配速文本 → 秒每公里（"5'50\"" / "5:50" / "6:00-6:15" 取首值 / "5分50"）；解析不出 null */
export function parsePaceText(t?: string | null): number | null {
  if (!t) return null;
  const m = /(\d{1,3})\s*['‘’:：′]\s*(\d{1,2})/.exec(t) ?? /(\d{1,3})\s*分\s*(\d{1,2})/.exec(t);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec > 0 && sec <= 1200 ? sec : null;
}

/** AI 草稿（模型友好单位）→ 整数口径 canonical content（越界值统一 upstream 400 面） */
export function draftToCanonicalPlan(draft: FitnessPlanDraft): { moduleCode: "run" | "strength"; content: RunPlanContent | StrengthPlanContent } {
  const canon = <T extends z.ZodTypeAny>(schema: T, v: unknown) => {
    const parsed = schema.safeParse(v);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw ApiError.upstream(`AI 草稿字段越界：${issue.path.join(".") || "(root)"} ${issue.message}`);
    }
    return parsed.data;
  };
  if (draft.module === "run" && draft.run) {
    const r = draft.run;
    return {
      moduleCode: "run",
      content: canon(RunPlanContentSchema, {
        workoutType: r.workoutType,
        title: r.title,
        segments: r.segments.map((s) => ({
          label: s.label,
          distanceM: s.distanceKm != null ? Math.round(s.distanceKm * 1000) : null,
          durationMin: s.durationMin ?? null,
          paceSPerKm: parsePaceText(s.paceText),
          hrZone: s.hrZone ?? null,
          hrBpmText: s.hrBpmText ?? null,
          reps: s.reps ?? null,
          note: s.note ?? null,
        })),
        totalDistanceM: r.totalDistanceKm != null ? Math.round(r.totalDistanceKm * 1000) : null,
        durationMin: r.durationMin ?? null,
        note: r.note ?? null,
      }),
    };
  }
  if (draft.module === "strength" && draft.strength) {
    const s = draft.strength;
    return {
      moduleCode: "strength",
      content: canon(StrengthPlanContentSchema, {
        title: s.title,
        exercises: s.exercises.map((e) => ({
          exerciseId: null,
          name: e.name.trim(),
          sets: e.sets ?? null,
          repsText: e.repsText ?? null,
          weightG: e.weightKg != null ? Math.round(e.weightKg * 1000) : null,
          rir: e.rir ?? null,
          note: e.note ?? null,
        })),
        durationMin: s.durationMin ?? null,
        note: s.note ?? null,
      }),
    };
  }
  throw ApiError.upstream("AI 返回的草稿缺少训练内容", `module=${draft.module} 无对应内容`);
}

/** 力量动作按名称挂动作库 id（精确优先，蛋壳包含兜底） */
async function resolveExerciseIds(content: StrengthPlanContent): Promise<StrengthPlanContent> {
  const names = [...new Set(content.exercises.map((e) => e.name).filter(Boolean))];
  if (!names.length) return content;
  const { rows } = await fitnessRepo.matchExercises(names);
  const exact = new Map(rows.map((r: { id: string; name: string }) => [r.name, r.id]));
  const loose = new Map(rows.map((r: { id: string; name: string }) => [r.name, r.id]));
  return {
    ...content,
    exercises: content.exercises.map((e) => ({
      ...e,
      exerciseId: exact.get(e.name) ?? (e.name.length >= 2 ? findLoose(loose, e.name) : null),
    })),
  };
}
function findLoose(loose: Map<string, string>, name: string): string | null {
  for (const [catalogName, id] of loose) {
    if (catalogName.includes(name) || name.includes(catalogName)) return id;
  }
  return null;
}

/** 训记名规范化注入（测试用；生产路径不传） */
export interface XunjiNormalizeOptions {
  fetcher?: XunjiFetchLike;
  /** AI 批量匹配注入（跳过真实 GLM 调用）；返回 source→official 候选（confidence 校验在编排内） */
  aiMatch?: (pending: string[], candidates: XunjiCatalogMovement[]) => Promise<{ source: string; official?: string | null; confidence: number }[]>;
}

/** 力量动作名匹配动作库 + 训记官方名对齐（REQ-022）：先挂拾光 exerciseId（原名口径，肌群/收益展示不受改名影响），
 * 再把 name 替换为训记官方名、原名并入 note「佳易名：xxx」。目录不可得/AI 无把握时保留原名，绝不阻塞导入 */
async function attachExerciseIds(
  userId: string,
  moduleCode: string,
  content: RunPlanContent | StrengthPlanContent,
  opts?: XunjiNormalizeOptions,
) {
  if (moduleCode !== "strength") return content;
  const withIds = await resolveExerciseIds(content as StrengthPlanContent);
  const names = [...new Set(withIds.exercises.map((e) => e.name).filter(Boolean))];
  if (!names.length) return withIds;
  let mapping = new Map<string, string>();
  try {
    mapping = await matchXunjiOfficialNames(userId, names, opts);
  } catch {
    // 匹配编排自身全降级不抛，此处双保险：对齐失败只影响训记同步体验，不影响计划落库
  }
  return renameExercisesToOfficial(withIds, mapping);
}

// ---------------------------------------------------------------------------
// 模块 / 基本情况 / 目标
// ---------------------------------------------------------------------------

async function listModules() {
  const { rows } = await fitnessRepo.listModules();
  return { modules: rows };
}

async function getProfile(userId: string) {
  const { rows } = await fitnessRepo.getProfile(userId);
  return { profile: rows[0] ?? null };
}

const ProfileInput = z.object({
  heightCm: z.number().int().min(50).max(260).nullable().optional(),
  baseline: z.record(z.any()).optional(),
  experience: z.string().max(60).nullable().optional(),
  equipment: z.array(z.string().max(30)).max(10).optional(),
  weeklyDays: z.string().max(60).nullable().optional(),
  constraints: z.string().max(200).nullable().optional(),
});

async function saveProfile(userId: string, body: unknown) {
  const v = parseBody(ProfileInput, body);
  const { rows } = await fitnessRepo.upsertProfile(userId, {
    heightCm: v.heightCm ?? null,
    baseline: v.baseline ?? {},
    experience: v.experience ?? null,
    equipment: v.equipment ?? [],
    weeklyDays: v.weeklyDays ?? null,
    constraints: v.constraints ?? null,
  });
  return { profile: rows[0] };
}

async function assertModule(code: string) {
  const { rows } = await fitnessRepo.moduleExists(code);
  if (!rows.length) throw ApiError.badRequest("未知的训练模块");
}

async function listGoals(userId: string) {
  const { rows } = await fitnessRepo.listGoals(userId);
  return { goals: rows };
}

const GoalCreateInput = z.object({
  moduleCode: z.string().min(1).max(20),
  title: z.string().min(1).max(60),
  targetDate: bjDate.nullable().optional(),
  targets: z.record(z.any()).optional(),
  baseline: z.record(z.any()).optional(),
  strategy: z.record(z.any()).optional(),
});

async function createGoal(userId: string, body: unknown) {
  const v = parseBody(GoalCreateInput, body);
  await assertModule(v.moduleCode);
  const { rows } = await fitnessRepo.activeGoalOf(userId, v.moduleCode);
  if (rows.length) throw ApiError.conflict("该模块已有活跃目标，请先归档或达成");
  const inserted = await fitnessRepo.insertGoal(userId, {
    moduleCode: v.moduleCode,
    title: v.title.trim(),
    targetDate: v.targetDate ?? null,
    targets: v.targets ?? {},
    baseline: v.baseline ?? {},
    strategy: v.strategy ?? {},
  });
  return { goal: inserted.rows[0] };
}

const GoalPatchInput = z.object({
  title: z.string().min(1).max(60).optional(),
  targetDate: bjDate.nullable().optional(),
  status: z.enum(["active", "achieved", "archived"]).optional(),
  targets: z.record(z.any()).optional(),
  baseline: z.record(z.any()).optional(),
  strategy: z.record(z.any()).optional(),
});

async function updateGoal(userId: string, id: string, body: unknown) {
  if (!isUuid(id)) throw ApiError.badRequest("id 参数不合法");
  const v = parseBody(GoalPatchInput, body);
  const owned = await fitnessRepo.goalOwned(id, userId);
  if (!owned.rows.length) throw ApiError.notFound("目标不存在");
  if (v.status === "active") {
    const act = await fitnessRepo.activeGoalOf(userId, owned.rows[0].module_code);
    if (act.rows.length && act.rows[0].id !== id) throw ApiError.conflict("该模块已有活跃目标");
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown, json = false) => {
    vals.push(json ? JSON.stringify(val ?? {}) : val);
    sets.push(`${col} = $${vals.length}${json ? "::jsonb" : ""}`);
  };
  if (v.title !== undefined) push("title", v.title.trim());
  if (v.targetDate !== undefined) push("target_date", v.targetDate);
  if (v.status !== undefined) push("status", v.status);
  if (v.targets !== undefined) push("targets", v.targets, true);
  if (v.baseline !== undefined) push("baseline", v.baseline, true);
  if (v.strategy !== undefined) push("strategy", v.strategy, true);
  if (!sets.length) throw ApiError.badRequest("没有可更新的字段");
  vals.push(id, userId);
  const { rows } = await fitnessRepo.updateGoal(id, userId, sets, vals);
  return { goal: rows[0] };
}

// ---------------------------------------------------------------------------
// 每日计划
// ---------------------------------------------------------------------------

async function listPlans(userId: string, from: string, to: string) {
  const [f, t] = rangeGuard(from, to);
  const { rows } = await fitnessRepo.listPlans(userId, f, t);
  return { plans: rows };
}

const PlanSaveInput = z.object({
  planDate: bjDate,
  moduleCode: z.enum(["run", "strength"]),
  source: z.enum(["ai", "import", "manual"]).default("manual"),
  content: z.record(z.any()),
  rationale: z.string().max(600).nullable().optional(),
  originConversationId: z.string().uuid().nullable().optional(),
  /** 确认卡勾选「同时写入训记」：落库+行动联动成功后双写训记；失败不回滚拾光（REQ-017） */
  syncXunji: z.boolean().optional(),
});

/** 计划 content 校验（模块对应契约） */
function validateContent(moduleCode: "run" | "strength", content: unknown) {
  const parsed = moduleCode === "run" ? RunPlanContentSchema.safeParse(content) : StrengthPlanContentSchema.safeParse(content);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw ApiError.badRequest(`计划内容不合法：${issue.path.join(".") || "(root)"} ${issue.message}`);
  }
  return parsed.data;
}

/** POST /api/fitness/plans —— 新增草稿并联动今日行动（REQ-021：一天同模块可多条并存，旧 create-or-replace 废止） */
async function savePlanDraft(userId: string, body: unknown, opts?: XunjiNormalizeOptions) {
  const v = parseBody(PlanSaveInput, body);
  const content = validateContent(v.moduleCode, v.content);
  const enriched = await attachExerciseIds(userId, v.moduleCode, content, opts);
  const planRow = (
    await fitnessRepo.insertPlan(userId, {
      planDate: v.planDate,
      moduleCode: v.moduleCode,
      source: v.source,
      content: enriched,
      rationale: v.rationale ?? null,
      originConversationId: v.originConversationId ?? null,
    })
  ).rows[0];
  const sync = await syncPlanTodos(userId, planRow);
  let xunjiWarning: string | null = null;
  if (v.syncXunji) {
    try {
      const sync = await syncPlanToXunji(userId, planRow.id);
      // 目录外动作名待确认（REQ-023）：不视作失败——提示用户去计划卡完成确认
      if ("needsConfirmation" in sync && sync.needsConfirmation) {
        xunjiWarning = `有 ${sync.unmatched.length} 个动作需确认训记官方名：请在计划卡点「同步训记」完成确认`;
      }
    } catch (e) {
      // 训记失败不回滚拾光（计划与行动联动已生效）；warning 交前端提示
      xunjiWarning = e instanceof Error ? e.message : String(e);
    }
  }
  return { plan: planRow, syncedActions: sync.synced, xunjiWarning };
}

/** DELETE /api/fitness/plans/[id] —— 删除计划（任意状态）。
 * 联动今日行动随 FK 级联删除；已打卡的执行记录保留（plan_id 置空，转独立打卡历史）；
 * 训记侧已同步的训练不回滚（如需可在训记 App 自行删除） */
async function deletePlan(userId: string, id: string) {
  if (!isUuid(id)) throw ApiError.badRequest("id 参数不合法");
  const { rows } = await fitnessRepo.planOwned(id, userId);
  if (!rows.length) throw ApiError.notFound("计划不存在");
  await fitnessRepo.deletePlan(id, userId);
  return { deleted: true };
}

const PlanPatchInput = z.object({
  status: z.enum(["confirmed", "skipped", "done", "partial"]).optional(),
  content: z.record(z.any()).optional(),
  rationale: z.string().max(600).nullable().optional(),
  /** 打卡实际（status=done/partial 时随行落执行记录） */
  actual: z.record(z.any()).optional(),
  fatigue: z.number().int().min(1).max(10).nullable().optional(),
  sleepHours: z.number().min(0).max(16).nullable().optional(),
  soreness: z.string().max(60).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

/** PATCH /api/fitness/plans/[id] —— 确认/编辑草稿/skipped/打卡；打卡落执行记录并完成联动行动 */
async function updatePlan(userId: string, id: string, body: unknown) {
  if (!isUuid(id)) throw ApiError.badRequest("id 参数不合法");
  const v = parseBody(PlanPatchInput, body);
  const { rows } = await fitnessRepo.planOwned(id, userId);
  if (!rows.length) throw ApiError.notFound("计划不存在");
  const plan = rows[0];
  const doneLike = v.status === "done" || v.status === "partial";

  if (plan.status === "done" || plan.status === "partial") {
    throw ApiError.badRequest("该计划已打卡，不能再次修改");
  }
  // 打卡类字段必须伴随 status=done/partial（单独发 actual 没有语义）
  if (!doneLike && (v.actual !== undefined || v.fatigue !== undefined || v.sleepHours !== undefined)) {
    throw ApiError.badRequest("打卡实际数据需携带 status=done/partial");
  }
  if (v.content !== undefined && plan.status !== "draft") {
    throw ApiError.badRequest("仅草稿状态可编辑内容");
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown, json = false) => {
    vals.push(json ? JSON.stringify(val ?? {}) : val);
    sets.push(`${col} = $${vals.length}${json ? "::jsonb" : ""}`);
  };

  let planRow = plan;
  if (v.content !== undefined) {
    const content = validateContent(plan.module_code, v.content);
    push("content", await attachExerciseIds(userId, plan.module_code, content), true);
  }
  if (v.rationale !== undefined) push("rationale", v.rationale);
  if (v.status !== undefined) push("status", v.status);
  if (!sets.length) throw ApiError.badRequest("没有可更新的字段");
  vals.push(id, userId);
  planRow = (await fitnessRepo.updatePlan(id, userId, sets, vals)).rows[0];

  // skipped → 清理未完成联动行动；done/partial → 落执行记录 + 完成联动行动
  if (v.status === "skipped") {
    await fitnessRepo.deletePendingPlanTodos(id);
  } else if (doneLike) {
    await fitnessRepo.insertLog(userId, {
      logDate: planRow.plan_date,
      moduleCode: planRow.module_code,
      planId: id,
      actual: v.actual ?? {},
      fatigue: v.fatigue ?? null,
      soreness: v.soreness ?? null,
      note: v.note ?? null,
    });
    // 睡眠独立记录（REQ-024）：打卡兼容入参落到 sleep_logs（log_date=计划日），session_logs 不再存
    if (v.sleepHours != null) await fitnessRepo.upsertSleep(userId, planRow.plan_date, Math.round(v.sleepHours * 10), "checkin");
    await fitnessRepo.completePlanTodos(id);
  } else {
    // 内容/状态变化 → 行动与最新计划同步
    await syncPlanTodos(userId, planRow);
  }
  return { plan: planRow };
}

// ---------------------------------------------------------------------------
// 今日行动联动（FR-D）
// ---------------------------------------------------------------------------

/** 单一规则：计划存在且未 skipped → 行动与计划同步。
 * 力量课 = 父任务(kind='todo') + 每动作一条子行动(kind='action')；跑步课 = 单条独立行动。
 * due_at = 计划日 18:00（北京）——与首页「今日行动」due_at 当日口径一致；活动分类挂预设 'fitness'；
 * space_id 挂内置运动空间（REQ-018：训练行动出现在运动空间 TODO·行动栏），无则保持 null。 */
async function syncPlanTodos(
  userId: string,
  plan: { id: string; plan_date: string; module_code: string; source: string; status: string; content: unknown },
) {
  await fitnessRepo.deletePendingPlanTodos(plan.id);
  if (plan.status === "skipped") return { synced: 0 };
  const dueAtIso = `${plan.plan_date}T18:00:00+08:00`;
  const source: "ai" | "manual" = plan.source === "manual" ? "manual" : "ai";
  // 活动分类挂「健身」预设行；用户没有该行（理论上仅测试直插用户）则置空，不让联动挂掉计划保存
  const { rows: actRows } = await fitnessRepo.fitnessActivityId(userId);
  const activityId: string | null = actRows[0]?.id ?? null;
  const { rows: sportRows } = await fitnessRepo.sportSpaceId(userId);
  const spaceId: string | null = sportRows[0]?.id ?? null;
  const content = (plan.content ?? {}) as RunPlanContent | StrengthPlanContent;
  let synced = 0;

  if (plan.module_code === "strength") {
    const exs = (content as StrengthPlanContent).exercises ?? [];
    const parentTitle = String((content as StrengthPlanContent).title ?? "力量训练");
    const parent = (
      await fitnessRepo.insertPlanTodo(userId, {
        planId: plan.id,
        title: parentTitle,
        dueAtIso,
        source,
        kind: "todo",
        parentId: null,
        sort: 0,
        activityId,
        spaceId,
      })
    ).rows[0].id;
    synced += 1;
    for (let i = 0; i < exs.length; i++) {
      const e = exs[i];
      await fitnessRepo.insertPlanTodo(userId, {
        planId: plan.id,
        title: actionTitleOfExercise(e),
        dueAtIso,
        source,
        kind: "action",
        parentId: parent,
        sort: i + 1,
        activityId,
        spaceId,
      });
      synced += 1;
    }
  } else if ((content as RunPlanContent).title) {
    const c = content as RunPlanContent;
    const km = c.totalDistanceM ? ` · ${(c.totalDistanceM / 1000).toFixed(c.totalDistanceM % 1000 === 0 ? 0 : 1)}km` : "";
    await fitnessRepo.insertPlanTodo(userId, {
      planId: plan.id,
      title: `${c.title}${km}`,
      dueAtIso,
      source,
      kind: "action",
      parentId: null,
      sort: 0,
      activityId,
      spaceId,
    });
    synced += 1;
  }
  return { synced };
}

/** 行动标题：「卧推 30kg×3×10」/「侧平举 2×12-15」/「平板支撑 3×45s」 */
function actionTitleOfExercise(e: { name: string; sets?: number | null; repsText?: string | null; weightG?: number | null }) {
  const dose = [e.sets, e.repsText].filter((x) => x != null && x !== "").join("×");
  if (e.weightG) return `${e.name} ${Math.round(e.weightG / 100) / 10}kg${dose ? "×" + dose : ""}`.slice(0, 60);
  return dose ? `${e.name} ${dose}`.slice(0, 60) : e.name;
}

// ---------------------------------------------------------------------------
// 训记（SynFit）Open API 编排（REQ-017；HTTP/映射细节见 xunji.ts）
// ---------------------------------------------------------------------------

// ---- 官方动作目录分层加载（REQ-022）：内存 1h → DB 快照 7 天 → 外呼刷新写回 ----

const XUNJI_CATALOG_MEM_TTL_MS = 3_600_000;
const XUNJI_CATALOG_DB_TTL_MS = 7 * 24 * 3_600_000;

interface XunjiCatalogSnapshot {
  at: number;
  movements: XunjiCatalogMovement[];
  /** 官方名 + 别名展开后的名字集合（makeOfficialResolver / 匹配校验共用口径） */
  names: Set<string>;
}
let xunjiCatalogMem: XunjiCatalogSnapshot | null = null;

/** 快照表行（jsonb）→ 规范化目录条目（写库时已规范化，此处容错解析防脏数据） */
function parseStoredMovements(raw: unknown): XunjiCatalogMovement[] {
  if (!Array.isArray(raw)) return [];
  const out: XunjiCatalogMovement[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; type?: unknown; exetype?: unknown; aliases?: unknown };
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    out.push({
      name: r.name.trim(),
      type: typeof r.type === "string" && r.type.trim() ? r.type.trim() : null,
      exetype: typeof r.exetype === "string" && r.exetype.trim() ? r.exetype.trim() : null,
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((n): n is string => typeof n === "string") : [],
    });
  }
  return out;
}

/** 分层加载官方动作目录：内存 1h → DB 快照（7 天内直接用）→ 外呼刷新并写回。
 * 全程降级不抛错：DB 读失败当无快照、外呼失败回退 DB 旧数据、再失败返回空集（调用方按「目录不可得」处理） */
export async function loadXunjiCatalog(fetcher?: XunjiFetchLike): Promise<XunjiCatalogSnapshot> {
  if (xunjiCatalogMem && Date.now() - xunjiCatalogMem.at < XUNJI_CATALOG_MEM_TTL_MS) return xunjiCatalogMem;
  const snap = (movements: XunjiCatalogMovement[]): XunjiCatalogSnapshot => {
    xunjiCatalogMem = { at: Date.now(), movements, names: catalogToNameSet(movements) };
    return xunjiCatalogMem;
  };
  let stored: { movements: XunjiCatalogMovement[]; fetchedAtMs: number } | null = null;
  try {
    const row = (await fitnessRepo.getXunjiCatalog()).rows[0] ?? null;
    const movements = parseStoredMovements(row?.movements);
    if (movements.length) stored = { movements, fetchedAtMs: row?.fetched_at ? new Date(row.fetched_at).getTime() : 0 };
  } catch {
    // 快照表不可用（迁移未跑/DB 抖动）——按无快照处理，走外呼
  }
  if (stored && Date.now() - stored.fetchedAtMs < XUNJI_CATALOG_DB_TTL_MS) return snap(stored.movements);
  try {
    const fresh = await fetchCatalogMovements(fetcher);
    if (fresh.length) {
      // 写回失败不影响本次使用（下次再试）；不 await 阻塞主流程
      fitnessRepo.upsertXunjiCatalog(fresh).catch(() => {});
      return snap(fresh);
    }
  } catch {
    // 外呼失败（未配 key/网络/限频）——回退 DB 旧快照
  }
  return snap(stored?.movements ?? []);
}

/** 测试辅助：清空目录内存快照（DB/外呼层下次读取重新判定；同 xunjiCacheInvalidate 的定位） */
export function resetXunjiCatalogCache(): void {
  xunjiCatalogMem = null;
}

// ---- 动作名 AI 匹配编排（REQ-022）：规则快速通道 → 残余批量走一次 GLM 文本匹配 ----

/** 目录全量入 prompt 的动作数上限（实测目录 1222 名——超过按字符重叠预筛候选） */
const XUNJI_MATCH_FULL_CATALOG_MAX = 800;
const XUNJI_MATCH_CANDIDATES_PER_NAME = 40;
const XUNJI_MATCH_MIN_CONFIDENCE = 0.6;

/** 字符重叠候选预筛：包含关系强加分 + 二元组重叠，取 top-N（目录过大时控制 prompt 体积） */
function prefilterCandidates(source: string, movements: XunjiCatalogMovement[], limit = XUNJI_MATCH_CANDIDATES_PER_NAME): XunjiCatalogMovement[] {
  const bigrams = (s: string) => {
    const g = new Set<string>();
    const cs = [...s];
    for (let i = 0; i + 1 < cs.length; i++) g.add(cs[i] + cs[i + 1]);
    return g;
  };
  const src = bigrams(source);
  return movements
    .map((m) => {
      let score = 0;
      if (m.name.includes(source) || source.includes(m.name)) score += 100;
      const mg = bigrams(m.name);
      for (const g of src) if (mg.has(g)) score += 2;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

/** 待匹配动作名 → 训记官方名映射（未匹配的名字不进映射，保留原名）。
 * 全程降级：目录不可得返回空映射；AI 失败/编造/低置信一律视为未匹配 */
export async function matchXunjiOfficialNames(userId: string, names: string[], opts: XunjiNormalizeOptions = {}): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  if (!names.length) return mapping;
  const snapshot = await loadXunjiCatalog(opts.fetcher);
  if (!snapshot.names.size) return mapping;
  // 别名读与目录读同口径降级：失败按无别名处理，匹配是增强路径不因库抖动阻断保存
  let aliasRows: { rows: { local_name: string; official_name: string }[] } = { rows: [] };
  try {
    aliasRows = await fitnessRepo.listXunjiAliases(userId);
  } catch {
    /* 降级 */
  }
  const userAliases: Record<string, string> = Object.fromEntries(
    aliasRows.rows.map((r: { local_name: string; official_name: string }) => [r.local_name, r.official_name]),
  );
  const { matched, pending } = ruleMatchOfficialNames(names, snapshot.names, userAliases);
  for (const [k, v] of matched) mapping.set(k, v);
  if (!pending.length) return mapping;

  // 候选目录：不大全量传；超上限按字符重叠为每个待匹配名预筛后合并去重
  let candidates = snapshot.movements;
  if (snapshot.movements.length > XUNJI_MATCH_FULL_CATALOG_MAX) {
    const seen = new Set<string>();
    candidates = [];
    for (const n of pending) {
      for (const c of prefilterCandidates(n, snapshot.movements)) {
        if (!seen.has(c.name)) {
          seen.add(c.name);
          candidates.push(c);
        }
      }
    }
  }

  const startedAt = Date.now();
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  try {
    let matches: { source: string; official?: string | null; confidence: number }[];
    if (opts.aiMatch) {
      matches = await opts.aiMatch(pending, candidates);
    } else {
      const bundle = await getPromptBundle("xunji_name_match");
      const user = await assembleUserPrompt("xunji_name_match", bundle, {
        names: JSON.stringify(pending),
        catalog: candidates.map((m) => (m.type ? `${m.name}（${m.type}）` : m.name)).join("\n"),
      });
      const raw = await chat({
        system: bundle.system,
        user,
        maxTokens: 1000,
        timeoutMs: 30_000,
        onUsage: (u) => {
          usage = u;
        },
      });
      const parsed = XunjiNameMatchResult.safeParse(extractJson(raw));
      if (!parsed.success) throw new Error(`匹配契约校验未通过：${parsed.error.issues.slice(0, 2).map((i) => i.message).join("；")}`);
      matches = parsed.data.matches;
    }
    for (const m of matches) {
      if (!pending.includes(m.source)) continue; // 与输入对不上（幻觉条目）丢弃
      const official = m.official?.trim();
      if (!official || !snapshot.names.has(official)) continue; // 防编造：必须逐字命中目录（官方名或别名）
      if ((m.confidence ?? 0) < XUNJI_MATCH_MIN_CONFIDENCE) continue; // 低置信保留原名
      mapping.set(m.source, official);
    }
    await writeAuditRecord({
      userId,
      stage: "xunji_name_match",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      textLen: pending.join(",").length,
      ok: true,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
  } catch (e) {
    await writeAuditRecord({
      userId,
      stage: "xunji_name_match",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      textLen: pending.join(",").length,
      ok: false,
      error: String((e as Error)?.message ?? e).slice(0, 200),
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
  }
  return mapping;
}

/** 计划 → 训记（用户已经过确认卡/按钮确认）。已同步过的计划带 localid 走更新，防重复建训练。
 * REQ-023：力量动作名先经 用户别名→内置别名→目录 分流，仍有目录外名字时返回
 * needsConfirmation（含候选官方名）交前端弹窗确认；确认调用带 mappings/skips——
 * 映射落别名表（此后自动生效）并可勾选跳过某动作（该动作不写入训记） */
async function syncPlanToXunji(
  userId: string,
  planId: string,
  fetcher?: XunjiFetchLike,
  confirm?: { mappings?: Record<string, string>; skips?: string[] },
) {
  const { rows } = await fitnessRepo.planOwned(planId, userId);
  if (!rows.length) throw ApiError.notFound("计划不存在");
  const plan = rows[0];
  if (plan.status === "done" || plan.status === "partial") throw ApiError.badRequest("已打卡计划不再同步训记");
  if (plan.status === "skipped") throw ApiError.badRequest("已跳过计划不同步训记");

  const snapshot = await loadXunjiCatalog(fetcher);
  const aliasRows = await fitnessRepo.listXunjiAliases(userId);
  const userAliases: Record<string, string> = Object.fromEntries(
    aliasRows.rows.map((r: { local_name: string; official_name: string }) => [r.local_name, r.official_name]),
  );

  let resolved = new Map<string, string>();
  let skips = new Set<string>();
  let runCardioOk = true;
  if (plan.module_code === "strength") {
    const content = plan.content as StrengthPlanContent;
    const skipSet = new Set(confirm?.skips ?? []);
    const names = [...new Set(content.exercises.map((e) => e.name).filter((n) => n && !skipSet.has(n)))];
    const { resolved: split, unmatched } = splitOfficialNames(names, snapshot.names, userAliases);

    // 确认调用：校验并持久化映射（官方名必须 ∈ 目录快照，防拼错写进训记）
    if (confirm?.mappings) {
      const entries: { localName: string; officialName: string }[] = [];
      for (const [localName, officialName] of Object.entries(confirm.mappings)) {
        if (skipSet.has(localName)) continue;
        if (!snapshot.names.size || snapshot.names.has(officialName)) {
          entries.push({ localName, officialName });
          split.set(localName, officialName);
        }
      }
      if (entries.length) {
        await fitnessRepo.upsertXunjiAliases(userId, entries);
        for (const e of entries) userAliases[e.localName] = e.officialName;
      }
    }
    if (unmatched.length) {
      if (!snapshot.names.size) {
        // 目录不可得（未配 key/接口故障）：无候选可确认，退回旧拦截文案
        throw ApiError.badRequest(
          `动作「${unmatched[0]}」不在训记官方动作库——请改名或先在训记 App 确认可用动作名（当前无法获取动作目录）`,
        );
      }
      const stillUnmatched = unmatched.filter((n) => !split.has(n));
      if (stillUnmatched.length && !confirm) {
        return {
          needsConfirmation: true as const,
          unmatched: stillUnmatched.map((name) => ({
            name,
            candidates: prefilterCandidates(name, snapshot.movements, 8).map((m) => ({ name: m.name, type: m.type })),
          })),
        };
      }
      if (stillUnmatched.length) {
        throw ApiError.badRequest(`动作「${stillUnmatched.join("」「")}」缺少确认映射，无法写入训记`);
      }
    }
    resolved = split;
    skips = skipSet;

    // 确认后回写计划内容：映射名替换 + 佳易名备注（与保存路径同管线，保持两端一致）
    const renameMap = new Map([...resolved.entries()].filter(([local, official]) => local !== official));
    if (confirm && renameMap.size) {
      const renamed = renameExercisesToOfficial(content, renameMap);
      if (renamed !== content) {
        await fitnessRepo.updatePlan(planId, userId, ["content = $1::jsonb"], [JSON.stringify(renamed), planId, userId]);
      }
    }
  } else if (plan.module_code === "run") {
    runCardioOk = !snapshot.names.size || snapshot.names.has("跑步");
  }
  if (!runCardioOk) throw ApiError.badRequest("动作「跑步」不在训记官方动作库，无法同步有氧日");

  const officialName = (name: string) =>
    skips.has(name) ? null : resolved.get(name) ?? (snapshot.names.has(name) ? name : null);
  const train = planToTrain(
    { module_code: plan.module_code, plan_date: plan.plan_date, content: plan.content },
    officialName,
  );
  if (!train.movements.length) {
    throw ApiError.badRequest("没有可写入训记的动作（全部被跳过或缺目标），请检查计划内容");
  }
  const prev = (plan.xunji_sync ?? null) as { localids?: string[] } | null;
  if (prev?.localids?.length) train.localid = prev.localids[0]; // 更新保留 localid（start/end 原样透传由服务端默认）

  const normalized = await upsertTrains(plan.plan_date, [train], plan.id, fetcher);
  const localids = normalized.map((t) => t.localid).filter((x): x is string | number => x != null);
  await fitnessRepo.updateXunjiSync(planId, userId, { localids, syncedAt: new Date().toISOString() });
  return {
    synced: true,
    updated: Boolean(prev?.localids?.length),
    movements: train.movements.length,
    localids,
    skipped: [...skips],
  };
}

/** 训记完成数据 → 拾光打卡。preview=true 只组装不落库（前端预览弹窗）；正式走 updatePlan 状态机 */
async function pullXunjiCompletion(
  userId: string,
  planId: string,
  opts: { preview?: boolean } = {},
  fetcher?: XunjiFetchLike,
) {
  const { rows } = await fitnessRepo.planOwned(planId, userId);
  if (!rows.length) throw ApiError.notFound("计划不存在");
  const plan = rows[0];
  if (plan.status === "done" || plan.status === "partial") throw ApiError.badRequest("该计划已打卡，不能再次同步");

  const trains = await readTrains(plan.plan_date, true, fetcher);
  let actual: Record<string, unknown>;
  let summary: string;
  if (plan.module_code === "strength") {
    const r = trainsToStrengthActual(trains, makeLocalResolver());
    if (!r.exercises.length) {
      throw ApiError.badRequest("训记里这一天还没有打勾的力量组——先在训记 App 完成打勾再同步");
    }
    const allDone = r.doneSets > 0 && r.doneSets >= r.totalSets;
    actual = { exercises: r.exercises };
    summary = `${r.exercises.length} 个动作 ${r.doneSets}/${r.totalSets} 组完成`;
    if (!opts.preview) {
      await updatePlan(userId, planId, { status: allDone ? "done" : "partial", actual, note: `训记同步：${summary}` });
    }
    return { preview: Boolean(opts.preview), status: allDone ? "done" : "partial", summary, actual };
  }
  const runActual = trainsToRunActual(trains);
  if (runActual.distanceM == null && runActual.durationS == null) {
    throw ApiError.badRequest("训记里这一天还没有有氧（跑步）记录——先在训记 App 记录再同步");
  }
  actual = { ...runActual };
  if (runActual.distanceM != null && runActual.durationS != null) {
    actual.paceSPerKm = Math.round(runActual.durationS / (runActual.distanceM / 1000));
  }
  summary = `${(runActual.distanceM ?? 0) / 1000}km · ${Math.round((runActual.durationS ?? 0) / 60)} 分钟`;
  if (!opts.preview) {
    await updatePlan(userId, planId, { status: "done", actual, note: "训记同步（有氧日）" });
  }
  return { preview: Boolean(opts.preview), status: "done", summary, actual };
}

/** 前端按钮显隐用：训记功能是否已配置 */
function xunjiEnabled() {
  return { enabled: Boolean(loadConfig().xunjiApiKey) };
}

// ---------------------------------------------------------------------------
// 执行记录 / 身体指标 / 动作库
// ---------------------------------------------------------------------------

async function listLogs(userId: string, from: string, to: string) {
  const [f, t] = rangeGuard(from, to);
  const { rows } = await fitnessRepo.listLogs(userId, f, t);
  return { logs: rows };
}

const LogInput = z.object({
  logDate: bjDate,
  moduleCode: z.enum(["run", "strength"]),
  planId: z.string().uuid().nullable().optional(),
  actual: z.record(z.any()).optional(),
  fatigue: z.number().int().min(1).max(10).nullable().optional(),
  sleepHours: z.number().min(0).max(16).nullable().optional(),
  soreness: z.string().max(60).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

/** POST /api/fitness/logs —— 独立补录（不经计划打卡） */
async function addLog(userId: string, body: unknown) {
  const v = parseBody(LogInput, body);
  const { rows } = await fitnessRepo.insertLog(userId, {
    logDate: v.logDate,
    moduleCode: v.moduleCode,
    planId: v.planId ?? null,
    actual: v.actual ?? {},
    fatigue: v.fatigue ?? null,
    soreness: v.soreness ?? null,
    note: v.note ?? null,
  });
  if (v.sleepHours != null) await fitnessRepo.upsertSleep(userId, v.logDate, Math.round(v.sleepHours * 10), "checkin");
  return { log: rows[0] };
}

async function listMetrics(userId: string, from: string, to: string) {
  const [f, t] = rangeGuard(from, to);
  const { rows } = await fitnessRepo.listMetrics(userId, f, t);
  return { metrics: rows };
}

const MetricInput = z.object({
  measuredOn: bjDate,
  weightKg: z.number().min(20).max(300).nullable().optional(),
  waistCm: z.number().min(30).max(200).nullable().optional(),
  bodyFatPct: z.number().min(3).max(60).nullable().optional(),
  heightCm: z.number().min(50).max(250).nullable().optional(),
  restingHr: z.number().int().min(30).max(130).nullable().optional(),
  note: z.string().max(100).nullable().optional(),
});

/** POST /api/fitness/metrics —— 按日 upsert（周一晨起空腹口径，人体可读单位入参 → 整数口径入库） */
async function saveMetric(userId: string, body: unknown) {
  const v = parseBody(MetricInput, body);
  const { rows } = await fitnessRepo.upsertMetric(userId, {
    measuredOn: v.measuredOn,
    weightG: v.weightKg != null ? Math.round(v.weightKg * 1000) : null,
    waistMm: v.waistCm != null ? Math.round(v.waistCm * 10) : null,
    bodyFatPctX10: v.bodyFatPct != null ? Math.round(v.bodyFatPct * 10) : null,
    heightMm: v.heightCm != null ? Math.round(v.heightCm * 10) : null,
    restingHr: v.restingHr ?? null,
    note: v.note ?? null,
  });
  return { metric: rows[0] };
}

// ---- 睡眠（REQ-024 每日独立记录；打卡兼容入参也落到这里）----

async function listSleep(userId: string, from: string, to: string) {
  const [f, t] = rangeGuard(from, to);
  const { rows } = await fitnessRepo.listSleep(userId, f, t);
  return { sleep: rows.map((r: { log_date: string; sleep_h_x10: number; source: string }) => ({ ...r, hours: r.sleep_h_x10 / 10 })) };
}

const SleepInput = z.object({
  date: bjDate,
  hours: z.number().min(0).max(16),
  feeling: z.enum(["good", "ok", "bad"]).nullable().optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
});

/** POST /api/fitness/sleep —— 按日 upsert（昨晚睡眠，小时 + 可选感受/App 得分；同日重录=更新） */
async function saveSleep(userId: string, body: unknown, source: "manual" | "checkin" = "manual") {
  const v = parseBody(SleepInput, body);
  const { rows } = await fitnessRepo.upsertSleep(userId, v.date, Math.round(v.hours * 10), source, v.feeling ?? null, v.score ?? null);
  const row = rows[0] as { log_date: string; sleep_h_x10: number; feeling: string | null; score: number | null; source: string };
  return { sleep: { ...row, hours: row.sleep_h_x10 / 10 } };
}

async function listExercises(moduleCode: string | null) {
  const { rows } = await fitnessRepo.listExercises(moduleCode);
  return { exercises: rows };
}

// ---------------------------------------------------------------------------
// AI：粘贴文本 / 佳明截图 → 结构化草稿（不入库；调用方确认后走 savePlanDraft）
// ---------------------------------------------------------------------------

const PARSE_TEXT_MAX = 2000;

/** 截图入参约束（REQ-020）：客户端压缩后常规 <1MB，上限为防滥用兜底 */
const PARSE_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const PARSE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** 休息日语义（REQ-019 FR-A1）：短文本直接命中不耗 AI；模型判 rest 的草稿转同款 400 文案 */
const REST_TEXT_RE = /无安排|没有(课表|训练|安排)|休息日?|^rest$/i;
export function restDayMessage(note?: string | null) {
  return `识别为休息日：今天没有训练安排，无需导入计划${note ? `（${note}）` : ""}`;
}

/** POST /api/fitness/plans/parse —— GLM 解析 + 一次修复重问；输出整数口径草稿（含动作库挂接）。
 * text 与 image 至少一项：image（佳明训练详情截图）走视觉模型 GLM_VISION_MODEL，text 作补充说明可空 */
async function parsePlanDraft(userId: string, text: string, image?: ChatImage, opts?: XunjiNormalizeOptions) {
  const t = text.trim();
  if (t.length > PARSE_TEXT_MAX) throw ApiError.badRequest(`课表文本长度须为 0~${PARSE_TEXT_MAX} 字`);
  if (!t && !image) throw ApiError.badRequest("课表文本或截图至少提供一项");
  // 休息日短文本短路只对纯文本输入生效——附图时文字可能只是补充说明
  if (!image && t && t.length <= 30 && REST_TEXT_RE.test(t)) throw ApiError.badRequest(restDayMessage());
  if (image) validateParseImage(image);

  const bundle = await getPromptBundle("fitness_plan_parse");
  const base = await assembleUserPrompt(
    "fitness_plan_parse",
    bundle,
    { text: t || (image ? "（见附图：佳明训练详情截图，以截图步骤为准）" : "") },
  );
  const startedAt = Date.now();
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  const onUsage = (u: { prompt_tokens: number; completion_tokens: number }) => {
    usage = u;
  };
  const auditModel = image ? activeVisionModel() : activeModel();

  const runOnce = async (userPrompt: string) => {
    const raw = await chat({
      system: bundle.system,
      user: userPrompt,
      // 截图识别延迟高于纯文本（视觉模型+图编码），预算与输出上限同放宽
      images: image ? [image] : undefined,
      maxTokens: image ? 2048 : undefined,
      timeoutMs: image ? 60_000 : undefined,
      onUsage,
    });
    let json: unknown;
    try {
      json = extractJson(raw);
    } catch (e) {
      // 模型输出纯文字（无 JSON）：转 badOutput 走修复重问，而非普通 Error 穿透 toApiError 成 500
      throw new GlmError("badOutput", (e as Error)?.message ?? "输出中无 JSON");
    }
    const parsed = FitnessPlanDraftV2.safeParse(json);
    return { raw, parsed };
  };

  try {
    let { raw, parsed } = await runOnce(base);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      ({ raw, parsed } = await runOnce(buildRepairUserPrompt(base, raw, issues)));
      if (!parsed.success) {
        throw new GlmError("badOutput", `重问后仍不合格：${parsed.error.issues.slice(0, 3).map((i) => i.message).join("；")}`);
      }
    }
    if (parsed.data.module === "rest") {
      throw ApiError.badRequest(restDayMessage(parsed.data.rest?.note ?? null));
    }
    const canonical = draftToCanonicalPlan(parsed.data);
    const content = await attachExerciseIds(userId, canonical.moduleCode, canonical.content, opts);
    await writeAuditRecord({
      userId,
      stage: "fitness_parse",
      model: auditModel,
      latencyMs: Date.now() - startedAt,
      textLen: t.length,
      ok: true,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
    return {
      draft: {
        moduleCode: canonical.moduleCode,
        source: "import" as const,
        content,
        rationale: parsed.data.reasoning ?? null,
      },
    };
  } catch (e) {
    // 计数/限流类失败转 503 文案（与 chat 域同口径）；其余透传（badOutput 由基座映射 502）
    await writeAuditRecord({
      userId,
      stage: "fitness_parse",
      model: auditModel,
      latencyMs: Date.now() - startedAt,
      textLen: t.length,
      ok: false,
      error: String((e as Error)?.message ?? e).slice(0, 200),
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
    if (e instanceof GlmError && (e.kind === "quota" || e.kind === "rate")) {
      throw ApiError.upstream("AI 服务暂时不可用（限流/额度），请稍后再试");
    }
    if (e instanceof GlmError && e.kind === "auth") throw ApiError.upstream("AI 未配置或鉴权失败，无法解析");
    throw e;
  }
}

/** 截图入参守卫：MIME 白名单 + base64 字符集 + 解码体积粗检（详细魔数校验交给视觉服务端） */
function validateParseImage(image: ChatImage): void {
  if (!(PARSE_IMAGE_MIMES as readonly string[]).includes(image.mimeType)) {
    throw ApiError.badRequest("截图仅支持 JPEG/PNG/WebP/GIF 格式");
  }
  if (image.base64.length < 100 || !/^[A-Za-z0-9+/=\r\n]+$/.test(image.base64)) {
    throw ApiError.badRequest("截图数据不合法");
  }
  if (Math.floor(image.base64.length * 0.75) > PARSE_IMAGE_MAX_BYTES) {
    throw ApiError.badRequest("截图过大（解码后超过 6MB），请压缩后再试");
  }
}

/** 路由统一服务出口（路由文件只做 解析入参 → 调 service → 返回） */
export const fitnessService = {
  listModules,
  getProfile,
  saveProfile,
  listGoals,
  createGoal,
  updateGoal,
  listPlans,
  savePlanDraft,
  updatePlan,
  deletePlan,
  parsePlanDraft,
  syncPlanToXunji,
  pullXunjiCompletion,
  xunjiEnabled,
  listLogs,
  addLog,
  listMetrics,
  saveMetric,
  listSleep,
  saveSleep,
  listExercises,
};

export { syncPlanTodos };
