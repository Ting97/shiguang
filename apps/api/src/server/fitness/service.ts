/**
 * fitness 域 service（REQ-016）：手写校验 + ApiError + 编排 repo。
 * 计划为中心：POST /plans = 新增草稿（REQ-021：一天同模块可多条并存）；DELETE /plans/[id] 删除（行动级联清理）；
 * 计划落库即联动今日行动（syncPlanTodos 单一规则：计划存在且未 skipped → 行动与计划同步）；
 * 打卡 done/partial 落执行记录并把联动行动置完成。
 * AI：POST /plans/parse 粘贴文本或佳明截图 → FitnessPlanDraftV2（GLM + 一次修复重问）→ 整数口径草稿（不入库）。
 */
import { z } from "zod";
import { pool } from "../platform/db";
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
import { assembleUserPrompt, checkAiQuota, getPromptBundle, writeAuditRecord } from "@/server/ai";
import { syncSleepBlock, syncSleepBlockInTx } from "@/server/time";
import { invalidateReviewCachesForOccurrence } from "@/server/insight";
import { fitnessRepo } from "./repo";
import { getXunjiKey, getXunjiKeyInfo, removeXunjiKey, saveXunjiKey } from "./xunji-keys";
import {
  catalogToNameSet,
  fetchCatalogMovements,
  makeLocalResolver,
  planToTrain,
  readTrains,
  renameExercisesToOfficial,
  resolveRunOfficialName,
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
  // 名称→id 映射单份（旧 exact/loose 两份内容完全相同）
  const exact = new Map(rows.map((r: { id: string; name: string }) => [r.name, r.id]));
  const loose = exact;
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

/** 活跃目标唯一偏索引 23505 收口：并发双建/双激活时「先查后写」窗口双双通过守卫，
 * 第二笔写直撞 idx_fitness_goals_active（user_id, module_code) where status='active' → 裸 500，转 409 */
async function catchActiveGoalConflict<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") throw ApiError.conflict(message);
    throw e;
  }
}

async function createGoal(userId: string, body: unknown) {
  const v = parseBody(GoalCreateInput, body);
  await assertModule(v.moduleCode);
  const { rows } = await fitnessRepo.activeGoalOf(userId, v.moduleCode);
  if (rows.length) throw ApiError.conflict("该模块已有活跃目标，请先归档或达成");
  const inserted = await catchActiveGoalConflict(
    () =>
      fitnessRepo.insertGoal(userId, {
        moduleCode: v.moduleCode,
        title: v.title.trim(),
        targetDate: v.targetDate ?? null,
        targets: v.targets ?? {},
        baseline: v.baseline ?? {},
        strategy: v.strategy ?? {},
      }),
    "该模块已有活跃目标，请先归档或达成",
  );
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
  const { rows } = await catchActiveGoalConflict(
    () => fitnessRepo.updateGoal(id, userId, sets, vals),
    "该模块已有活跃目标",
  );
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
  // 计划落库与联动行动重建同事务：中途失败整体回滚，不再出现「计划已存而行动为空」的半程态
  const client = await pool.connect();
  type PlanRow = { id: string; plan_date: string; module_code: string; source: string; status: string; content: unknown };
  let planRow: PlanRow;
  let synced: { synced: number };
  try {
    await client.query("begin");
    planRow = (
      await fitnessRepo.insertPlan(userId, {
        planDate: v.planDate,
        moduleCode: v.moduleCode,
        source: v.source,
        content: enriched,
        rationale: v.rationale ?? null,
        originConversationId: v.originConversationId ?? null,
      }, client)
    ).rows[0] as PlanRow;
    synced = await syncPlanTodos(userId, planRow, client);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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
  return { plan: planRow, syncedActions: synced.synced, xunjiWarning };
}

/** DELETE /api/fitness/plans/[id] —— 删除计划（任意状态）。
 * 联动今日行动随 FK 级联删除；已打卡的执行记录保留（plan_id 置空，转独立打卡历史）；
 * 训记侧已同步的训练不回滚（如需可在训记 App 自行删除） */
async function deletePlan(userId: string, id: string) {
  if (!isUuid(id)) throw ApiError.badRequest("id 参数不合法");
  const { rows } = await fitnessRepo.planOwned(id, userId);
  if (!rows.length) throw ApiError.notFound("计划不存在");
  // 级联删除含已完成联动 todo（FK on delete cascade）：删除让复盘水位 max(done_at) 回退、
  // 当期小结被判「仍新鲜」而滞留已不存在的完成记录——删前采 done_at、删后显式失效（十九轮补）
  const doneAts = (
    await pool.query(`select done_at from todos where fitness_plan_id = $1 and user_id = $2 and done_at is not null`, [id, userId])
  ).rows as { done_at: string | Date }[];
  await fitnessRepo.deletePlan(id, userId);
  for (const r of doneAts) void invalidateReviewCachesForOccurrence(userId, new Date(r.done_at));
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

  // 打卡类字段必须伴随 status=done/partial（单独发 actual 没有语义；soreness/note 同属打卡入参，
  // 缺守卫时会被下方静默丢弃——调用方以为记上了）
  if (
    !doneLike &&
    (v.actual !== undefined || v.fatigue !== undefined || v.sleepHours !== undefined || v.soreness !== undefined || v.note !== undefined)
  ) {
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

  if (v.content !== undefined) {
    const content = validateContent(plan.module_code, v.content);
    push("content", await attachExerciseIds(userId, plan.module_code, content), true);
  }
  if (v.rationale !== undefined) push("rationale", v.rationale);
  if (v.status !== undefined) push("status", v.status);
  if (!sets.length) throw ApiError.badRequest("没有可更新的字段");
  vals.push(id, userId);

  // 状态迁移与后续写（执行记录/睡眠/联动行动）收进同一事务，事务首语句锁计划行并锁内重读状态：
  // 并发双击/重发打卡时只有一个请求能通过「未打卡」守卫（历史 bug：锁外快照守卫 + 无条件 UPDATE 可重复落执行记录）；
  // 事务也消除「计划已置 done 而执行记录插入失败」的半程态
  let sleepInvals: Date[] = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      `select status from fitness_daily_plans where id = $1 and user_id = $2 for update`,
      [id, userId],
    );
    if (!locked.rows.length) throw ApiError.notFound("计划不存在");
    if (locked.rows[0].status === "done" || locked.rows[0].status === "partial") {
      throw ApiError.badRequest("该计划已打卡，不能再次修改");
    }
    // 内容编辑守卫锁内复核（二十轮）：上方 `仅草稿可编辑` 用的是事务前快照——
    // 并发 draft→confirmed 落在快照与加锁之间时，已确认计划的内容仍会被改
    if (v.content !== undefined && locked.rows[0].status !== "draft") {
      throw ApiError.badRequest("仅草稿状态可编辑内容");
    }
    const planRow = (await fitnessRepo.updatePlan(id, userId, sets, vals, client)).rows[0];

    // skipped → 清理未完成联动行动；done/partial → 落执行记录 + 完成联动行动
    if (v.status === "skipped") {
      await fitnessRepo.deletePendingPlanTodos(id, client);
    } else if (doneLike) {
      await fitnessRepo.insertLog(userId, {
        logDate: planRow.plan_date,
        moduleCode: planRow.module_code,
        planId: id,
        actual: v.actual ?? {},
        fatigue: v.fatigue ?? null,
        soreness: v.soreness ?? null,
        note: v.note ?? null,
      }, client);
      // 睡眠独立记录（REQ-024）：打卡兼容入参落到 sleep_logs（log_date=计划日），session_logs 不再存；
      // 同事务内同步日程睡眠块（REQ-038）：先持计划行锁、syncSleepBlockInTx 内取 timeblocks advisory
      // lock，锁序恒为 plan → advisory；冲突静默跳过（ok:false），睡眠数据照常落库
      if (v.sleepHours != null) {
        const srow = (await fitnessRepo.upsertSleep(userId, planRow.plan_date, Math.round(v.sleepHours * 10), "checkin", undefined, undefined, client)).rows[0];
        sleepInvals = (await syncSleepBlockInTx(userId, { sleepLogId: srow.id, logDate: srow.log_date, sleepHX10: srow.sleep_h_x10 }, client)).invalidateAts;
      }
      await fitnessRepo.completePlanTodos(id, client);
    } else {
      // 内容/状态变化 → 行动与最新计划同步
      await syncPlanTodos(userId, planRow, client);
    }
    await client.query("commit");
    // 睡眠同步块的复盘缓存失效在提交后触发（事务内先行失效会被并发生成以旧数据重建）
    for (const at of sleepInvals) void invalidateReviewCachesForOccurrence(userId, at);
    return { plan: planRow };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 今日行动联动（FR-D）
// ---------------------------------------------------------------------------

/** 单一规则：计划存在且未 skipped → 行动与计划同步（已打卡的同名行动跳过不重建、父任务复用旧 id）。
 * 力量课 = 父任务(kind='todo') + 每动作一条子行动(kind='action')；跑步课 = 单条独立行动。
 * due_at = 计划日 18:00（北京）——与首页「今日行动」due_at 当日口径一致；活动分类挂预设 'fitness'；
 * space_id 挂内置运动空间（REQ-018：训练行动出现在运动空间 TODO·行动栏），无则保持 null。 */
async function syncPlanTodos(
  userId: string,
  plan: { id: string; plan_date: string; module_code: string; source: string; status: string; content: unknown },
  exec: Pick<typeof pool, "query"> = pool,
) {
  // 「删旧插新」由调用方事务包裹：中途失败可整体回滚，避免行动丢失（历史窗口：计划已存而联动行动为空）
  const { unhookedIds } = await fitnessRepo.deletePendingPlanTodos(plan.id, exec);
  if (plan.status === "skipped") return { synced: 0 };
  // 已打卡行动（用户在今日行动里勾掉的 done 行保留作历史）：同名重建时跳过、父任务复用旧 id——
  // 否则确认/编辑计划会把已勾掉的动作以新 pending 行复制出来（今日行动重复出现 + done 历史并存）
  const { rows: doneRows } = await fitnessRepo.donePlanTodos(plan.id, exec);
  const doneTitleToId = new Map<string, string>(doneRows.map((r: { title: string; id: string }) => [r.title, r.id]));
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
    // 父任务已打卡 → 复用旧行 id 保持子行动挂载，不新建
    let parentId: string | null = doneTitleToId.get(parentTitle) ?? null;
    if (!parentId) {
      const newParentId = String(
        (
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
          }, exec)
        ).rows[0].id,
      );
      parentId = newParentId;
      // 原 pending 父被删时其 done 子行动已解挂保命：回挂到新父，完成历史不散落顶层
      if (unhookedIds.length > 0) await fitnessRepo.reparentTodos(newParentId, unhookedIds, exec);
      synced += 1;
    }
    for (let i = 0; i < exs.length; i++) {
      const e = exs[i];
      const title = actionTitleOfExercise(e);
      if (doneTitleToId.has(title)) continue; // 已打卡的同名行动不重复建 pending
      await fitnessRepo.insertPlanTodo(userId, {
        planId: plan.id,
        title,
        dueAtIso,
        source,
        kind: "action",
        parentId,
        sort: i + 1,
        activityId,
        spaceId,
      }, exec);
      synced += 1;
    }
  } else if ((content as RunPlanContent).title) {
    const c = content as RunPlanContent;
    const km = c.totalDistanceM ? ` · ${(c.totalDistanceM / 1000).toFixed(c.totalDistanceM % 1000 === 0 ? 0 : 1)}km` : "";
    const title = `${c.title}${km}`;
    if (!doneTitleToId.has(title)) {
      await fitnessRepo.insertPlanTodo(userId, {
        planId: plan.id,
        title,
        dueAtIso,
        source,
        kind: "action",
        parentId: null,
        sort: 0,
        activityId,
        spaceId,
      }, exec);
      synced += 1;
    }
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

  // AI 额度门禁（402 面与 trades-review 一致）：门禁只拦真正的 GLM 调用——规则/别名已全量命中
  // （pending 空）不消耗额度；测试注入 aiMatch 不走真实模型，同样不拦。调用方（attachExerciseIds）
  // 对本编排整体降级容错，额度用尽时按「未匹配保留原名」继续，不阻塞计划保存
  if (!opts.aiMatch) {
    const q = await checkAiQuota(userId);
    if (!q.allowed) throw new ApiError(402, "quota", `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限匹配`);
  }

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

/** 未绑定训记 key 的统一拦截文案（REQ-041：用户数据操作严格走本人 key，不再回落部署级运营者账号） */
const requireUserXunjiKey = async (userId: string) => {
  const key = await getXunjiKey(userId);
  if (!key) {
    throw ApiError.forbidden("尚未绑定训记 apiKey——请在【我的 → 训记同步】配置自己训记 App 内申请的 key 后再同步");
  }
  return key;
};

/** 计划 → 训记（用户已经过确认卡/按钮确认）。已同步过的计划带 localid 走更新，防重复建训练。
 * REQ-023：力量动作名先经 用户别名→内置别名→目录 分流，仍有目录外名字时返回
 * needsConfirmation（含候选官方名）交前端弹窗确认；确认调用带 mappings/skips——
 * 映射落别名表（此后自动生效）并可勾选跳过某动作（该动作不写入训记）。
 * REQ-023 v1.1：跑步（有氧日）写入名自动对齐目录内官方跑步条目（「跑步（有氧）」优先），
 * 不再因目录无逐字「跑步」而 400；目录确无跑步类条目时回退直写并带 warning */
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

  const apiKey = await requireUserXunjiKey(userId); // 写入的是用户自己的训记账号（REQ-041）

  const snapshot = await loadXunjiCatalog(fetcher);
  const aliasRows = await fitnessRepo.listXunjiAliases(userId);
  const userAliases: Record<string, string> = Object.fromEntries(
    aliasRows.rows.map((r: { local_name: string; official_name: string }) => [r.local_name, r.official_name]),
  );

  let resolved = new Map<string, string>();
  let skips = new Set<string>();
  let runOfficialName = "跑步";
  let runWarning: string | undefined;
  if (plan.module_code === "strength") {
    const content = plan.content as StrengthPlanContent;
    const skipSet = new Set(confirm?.skips ?? []);
    const names = [...new Set(content.exercises.map((e) => e.name).filter((n) => n && !skipSet.has(n)))];
    const { resolved: split, unmatched } = splitOfficialNames(names, snapshot.names, userAliases);

    // 确认调用：校验并持久化映射（官方名必须 ∈ 目录快照，防拼错写进训记）。
    // 目录不可得时此前 `!snapshot.names.size ||` 短路放行——映射不校验直落别名表（脏映射此后自动生效），
    // 改为直接拒绝：确认弹窗本就依赖目录候选，目录缺失无确认语义
    if (confirm?.mappings) {
      if (!snapshot.names.size) throw ApiError.badRequest("训记动作目录不可得，无法校验确认映射，请稍后重试");
      const entries: { localName: string; officialName: string }[] = [];
      for (const [localName, officialName] of Object.entries(confirm.mappings)) {
        if (skipSet.has(localName)) continue;
        if (snapshot.names.has(officialName)) {
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

    // 确认后回写计划内容：映射名替换 + 佳易名备注（与保存路径同管线，保持两端一致）。
    // 条件更新自限状态：此处 plan.status 是锁外快照，并发打卡把计划置 done/partial 后
    // 裸 updatePlan 会覆盖已打卡计划的 content——限定 draft/confirmed，竞争失败即静默放弃回写
    const renameMap = new Map([...resolved.entries()].filter(([local, official]) => local !== official));
    if (confirm && renameMap.size) {
      const renamed = renameExercisesToOfficial(content, renameMap);
      if (renamed !== content) {
        await fitnessRepo.updatePlan(planId, userId, ["content = $1::jsonb"], [JSON.stringify(renamed), planId, userId], pool, " and status in ('draft','confirmed')");
      }
    }
  } else if (plan.module_code === "run") {
    const officialRun = resolveRunOfficialName(snapshot.movements);
    if (officialRun) runOfficialName = officialRun;
    else if (snapshot.names.size) runWarning = "训记动作目录暂无跑步类条目，已按「跑步」直写有氧日";
  }

  const officialName = (name: string) =>
    skips.has(name) ? null : resolved.get(name) ?? (snapshot.names.has(name) ? name : null);
  const train = planToTrain(
    { module_code: plan.module_code, plan_date: plan.plan_date, content: plan.content },
    officialName,
    runOfficialName,
  );
  if (!train.movements.length) {
    throw ApiError.badRequest("没有可写入训记的动作（全部被跳过或缺目标），请检查计划内容");
  }
  // —— 临界区（per-plan 会话级 advisory lock）——
  // 外部写（upsertTrains）成功而 localid 落库失败 → 下次同步 prev 为空走新建，训记侧出现重复训练
  // （其 API 无删除接口）；并发双击同步双双读到 prev=null 也各自新建。锁内重读 xunji_sync 收口两条窗口。
  const lockClient = await pool.connect();
  try {
    let locked = false;
    for (let i = 0; i < 50 && !locked; i++) {
      locked = (
        await lockClient.query(`select pg_try_advisory_lock(hashtext($1)) as locked`, [`xunji-sync:${planId}`])
      ).rows[0].locked;
      if (!locked) await new Promise((r) => setTimeout(r, 100));
    }
    if (!locked) throw ApiError.conflict("同步进行中，请稍候");

    // 锁内重读（十四轮注释声称的收口，十五轮补齐实现）：并发双击同步时 B 拿到锁后必须看到
    // A 已写回的 localid，否则仍用自己的过期快照（prev=null）走新建——训记侧产生重复训练
    // （其 API 无删除接口）且 updateXunjiSync 整体覆写会把 A 的 localid 抹掉成永久孤儿。
    // 状态守卫同样复核：并发打卡把计划置 done/partial/skipped 后，持锁的 B 不得再写入训记
    const freshRows = (await fitnessRepo.planOwned(planId, userId)).rows;
    if (!freshRows.length) throw ApiError.notFound("计划不存在");
    const fresh = freshRows[0];
    if (fresh.status === "done" || fresh.status === "partial") throw ApiError.badRequest("已打卡计划不再同步训记");
    if (fresh.status === "skipped") throw ApiError.badRequest("已跳过计划不同步训记");

    // 内容可能已被并发的确认映射改名：以锁内最新内容重建 train（officialName/runOfficialName 闭包仍有效）
    const freshTrain = planToTrain(
      { module_code: fresh.module_code, plan_date: fresh.plan_date, content: fresh.content },
      officialName,
      runOfficialName,
    );
    if (!freshTrain.movements.length) {
      throw ApiError.badRequest("没有可写入训记的动作（全部被跳过或缺目标），请检查计划内容");
    }
    const prev = ((fresh.xunji_sync ?? null) as { localids?: string[] } | null);
    if (prev?.localids?.length) freshTrain.localid = prev.localids[0]; // 更新保留 localid（start/end 原样透传由服务端默认）

    const normalized = await upsertTrains(fresh.plan_date, [freshTrain], plan.id, fetcher, apiKey);
    const localids = normalized.map((t) => t.localid).filter((x): x is string | number => x != null);
    try {
      await fitnessRepo.updateXunjiSync(planId, userId, { localids, syncedAt: new Date().toISOString() });
    } catch (e) {
      // 外部写已成功：localid 落库失败只能留线索人工去重（训记无删除接口，无法自动补偿）
      console.error("[xunji] localid 落库失败（训记侧可能产生重复训练）", { planId, userId, localids, err: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    return {
      synced: true,
      updated: Boolean(prev?.localids?.length),
      movements: freshTrain.movements.length,
      localids,
      skipped: [...skips],
      warning: runWarning,
    };
  } finally {
    await lockClient.query(`select pg_advisory_unlock(hashtext($1))`, [`xunji-sync:${planId}`]).catch(() => {});
    lockClient.release();
  }
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

  const apiKey = await requireUserXunjiKey(userId); // 读的是用户自己训记账号的实练（REQ-041）
  const trains = await readTrains(plan.plan_date, true, fetcher, apiKey);
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

/** 前端按钮显隐用：当前用户是否已绑定自己的训记 apiKey（REQ-041 起不再看部署级 env）。
 * enabled 保留旧字段名（前端兼容）；bound/masked/updatedAt 供配置卡展示 */
async function xunjiEnabled(userId: string) {
  const info = await getXunjiKeyInfo(userId);
  return { enabled: info.bound, ...info };
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
  // planId 只验 uuid 不够：需校验计划归属，防止把执行记录挂到他人计划上（FK 只保证存在性）
  if (v.planId) {
    const own = await fitnessRepo.planOwned(v.planId, userId);
    if (!own.rows.length) throw ApiError.badRequest("关联计划不存在");
  }
  // 执行记录 + 睡眠兼容入参收进同一事务（与 updatePlan 打卡路径同款）：
  // 独立自动提交在 sleep 写失败时会留下「记录已存、睡眠缺失」的半程态
  let sleepInvals: Date[] = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await fitnessRepo.insertLog(userId, {
      logDate: v.logDate,
      moduleCode: v.moduleCode,
      planId: v.planId ?? null,
      actual: v.actual ?? {},
      fatigue: v.fatigue ?? null,
      soreness: v.soreness ?? null,
      note: v.note ?? null,
    }, client);
    if (v.sleepHours != null) {
      // 同事务内同步日程睡眠块（REQ-038，与 updatePlan 打卡路径同款：锁序 plan/无 → advisory；
      // 冲突静默跳过，睡眠照常落库）
      const srow = (await fitnessRepo.upsertSleep(userId, v.logDate, Math.round(v.sleepHours * 10), "checkin", undefined, undefined, client)).rows[0];
      sleepInvals = (await syncSleepBlockInTx(userId, { sleepLogId: srow.id, logDate: srow.log_date, sleepHX10: srow.sleep_h_x10 }, client)).invalidateAts;
    }
    await client.query("commit");
    for (const at of sleepInvals) void invalidateReviewCachesForOccurrence(userId, at);
    return { log: rows[0] };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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

/** POST /api/fitness/metrics —— 按日 upsert（周一晨起空腹口径，人体可读单位入参 → 整数口径入库）。
 *  留空字段继承旧值：同日重录不抹掉已录字段；新日期留空继承最近一条非空（身高体脂可只在变化时记录）。
 *  UI 承诺「留空的项保持原值不被清除」——此前 null 直落新行，「最近」卡片身高/体脂凭空消失
 *  （十一轮 GUI 深度体验发现修复） */
async function saveMetric(userId: string, body: unknown) {
  const v = parseBody(MetricInput, body);
  // 读旧值→继承→upsert 包在 per-user advisory lock 事务内：无锁时同日并发两次保存，
  // 后者拿到过期 prev 会把前者刚写入、本次留空的字段覆盖回更旧的值（继承丢失）
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`fitness-metrics:${userId}`]);
    const prevR = await fitnessRepo.latestMetricAtOrBefore(userId, v.measuredOn, client);
    const prev = (prevR.rows[0] ?? {}) as {
      weight_g: number | null;
      waist_mm: number | null;
      body_fat_pct_x10: number | null;
      height_mm: number | null;
      resting_hr: number | null;
    };
    const keep = (now: number | null | undefined, old: number | null) => (now != null ? now : (old ?? null));
    const { rows } = await fitnessRepo.upsertMetric(userId, {
      measuredOn: v.measuredOn,
      weightG: keep(v.weightKg != null ? Math.round(v.weightKg * 1000) : null, prev.weight_g),
      waistMm: keep(v.waistCm != null ? Math.round(v.waistCm * 10) : null, prev.waist_mm),
      bodyFatPctX10: keep(v.bodyFatPct != null ? Math.round(v.bodyFatPct * 10) : null, prev.body_fat_pct_x10),
      heightMm: keep(v.heightCm != null ? Math.round(v.heightCm * 10) : null, prev.height_mm),
      restingHr: keep(v.restingHr ?? null, prev.resting_hr),
      note: v.note ?? null,
    }, client);
    await client.query("commit");
    return { metric: rows[0] };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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

/** POST /api/fitness/sleep —— 按日 upsert（昨晚睡眠，小时 + 可选感受/App 得分；同日重录=更新）。
 *  落库后同步生成日程「😴 睡眠」跨天块（REQ-038）：冲突/0h 不抛错照常返回 sync 结果，
 *  web 手动路径据此 toast；打卡兼容路径另有独立补录入口（addLog） */
async function saveSleep(userId: string, body: unknown, source: "manual" | "checkin" = "manual") {
  const v = parseBody(SleepInput, body);
  const { rows } = await fitnessRepo.upsertSleep(userId, v.date, Math.round(v.hours * 10), source, v.feeling ?? null, v.score ?? null);
  const row = rows[0] as { id: string; log_date: string; sleep_h_x10: number; feeling: string | null; score: number | null; source: string };
  const sync = await syncSleepBlock(userId, { sleepLogId: row.id, logDate: row.log_date, sleepHX10: row.sleep_h_x10 });
  return { sleep: { ...row, hours: row.sleep_h_x10 / 10 }, sync };
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

  // AI 额度门禁（402 面与 trades-review 一致）：这是全站此前唯一不计费的 GLM 入口，
  // 放在入参校验/休息日短路之后——参数错与休息日不占额度，真正要调模型前拦
  const q = await checkAiQuota(userId);
  if (!q.allowed) throw new ApiError(402, "quota", `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限解析`);

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
    // 日期预选提示（确定性，非模型输出）：课表写「明天/明早/明晚/明儿」时 UI 预选明天——
    // 否则解析弹窗默认「今天」，用户话术里的日期被静默忽略，计划落错天（十一轮 GUI 深度体验发现）。
    // 仅对文本判定：附图时 text 可能只是补充说明，不可靠
    const dateHint = !image && /明天|明儿|明早|明晚/.test(t) ? ("tomorrow" as const) : ("today" as const);
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
        dateHint,
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
  xunjiKeyInfo: getXunjiKeyInfo,
  xunjiKeySave: saveXunjiKey,
  xunjiKeyRemove: removeXunjiKey,
  getXunjiKey,
  listLogs,
  addLog,
  listMetrics,
  saveMetric,
  listSleep,
  saveSleep,
  listExercises,
};

export { syncPlanTodos };
