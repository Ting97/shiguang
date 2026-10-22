/**
 * fitness 域 repo（REQ-016）：全部参数化 SQL 唯一发生地。
 * 表：fitness_modules / fitness_profiles / fitness_goals / fitness_daily_plans /
 *     fitness_session_logs / fitness_body_metrics / fitness_exercises
 * 单位纪律：距离 m、时长/配速 s、体重 g、腰围 mm、体脂×10、睡眠小时×10。
 * 今日行动联动（todos.fitness_plan_id）的 SQL 也归本层：计划存在且未 skipped → 行动与计划同步。
 */
import { pool } from "@/server/platform/db";

export const fitnessRepo = {
  // ---- 模块目录 ----
  listModules() {
    return pool.query(
      `select code, name, icon, sort, is_active from fitness_modules
       where is_active order by sort, code`,
    );
  },

  // ---- 基本情况 ----
  getProfile(userId: string) {
    return pool.query(`select * from fitness_profiles where user_id = $1`, [userId]);
  },
  upsertProfile(
    userId: string,
    d: { heightCm: number | null; baseline: unknown; experience: string | null; equipment: unknown; weeklyDays: string | null; constraints: string | null },
  ) {
    return pool.query(
      `insert into fitness_profiles (user_id, height_cm, baseline, experience, equipment, weekly_days, "constraints")
       values ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7)
       on conflict (user_id) do update set
         height_cm = excluded.height_cm, baseline = excluded.baseline,
         experience = excluded.experience, equipment = excluded.equipment,
         weekly_days = excluded.weekly_days, "constraints" = excluded."constraints",
         updated_at = now()
       returning *`,
      [userId, d.heightCm, JSON.stringify(d.baseline ?? {}), d.experience, JSON.stringify(d.equipment ?? []), d.weeklyDays, d.constraints],
    );
  },

  // ---- 目标 ----
  listGoals(userId: string) {
    return pool.query(
      `select id, module_code, title, target_date::text as target_date, status, targets, baseline, strategy,
              to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created_bj
       from fitness_goals where user_id = $1 order by status = 'active' desc, created_at desc, id desc`,
      [userId],
    );
  },
  activeGoalOf(userId: string, moduleCode: string) {
    return pool.query(
      `select id from fitness_goals where user_id = $1 and module_code = $2 and status = 'active' limit 1`,
      [userId, moduleCode],
    );
  },
  moduleExists(code: string) {
    return pool.query(`select code from fitness_modules where code = $1 and is_active`, [code]);
  },
  goalOwned(id: string, userId: string) {
    return pool.query(`select id, module_code from fitness_goals where id = $1 and user_id = $2`, [id, userId]);
  },
  insertGoal(
    userId: string,
    d: { moduleCode: string; title: string; targetDate: string | null; targets: unknown; baseline: unknown; strategy: unknown },
  ) {
    return pool.query(
      `insert into fitness_goals (user_id, module_code, title, target_date, targets, baseline, strategy)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
       returning id, module_code, title, target_date::text as target_date, status, targets, baseline, strategy,
                 to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created_bj`,
      [userId, d.moduleCode, d.title, d.targetDate, JSON.stringify(d.targets ?? {}), JSON.stringify(d.baseline ?? {}), JSON.stringify(d.strategy ?? {})],
    );
  },
  updateGoal(
    id: string,
    userId: string,
    sets: string[],
    vals: unknown[],
  ) {
    return pool.query(
      `update fitness_goals set ${sets.join(", ")}, updated_at = now() where id = $${vals.length - 1} and user_id = $${vals.length}
       returning id, module_code, title, target_date::text as target_date, status, targets, baseline, strategy,
                 to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created_bj`,
      vals,
    );
  },

  // ---- 每日计划（date 列一律 ::text 返回，避免 node-pg 解析成 Date 再被模板串拼坏） ----
  listPlans(userId: string, from: string, to: string) {
    return pool.query(
      `select p.id, p.user_id, p.plan_date::text as plan_date, p.module_code, p.source, p.status, p.content,
              p.rationale, p.origin_conversation_id,
              to_char(p.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created_bj,
              to_char(p.updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as updated_bj,
              m.name as module_name, m.icon as module_icon
       from fitness_daily_plans p join fitness_modules m on m.code = p.module_code
       where p.user_id = $1 and p.plan_date between $2 and $3
       order by p.plan_date desc, m.sort, p.created_at, p.id`,
      [userId, from, to],
    );
  },
  planOwned(id: string, userId: string) {
    return pool.query(
      `select id, user_id, plan_date::text as plan_date, module_code, source, status, content, rationale, origin_conversation_id, xunji_sync
       from fitness_daily_plans where id = $1 and user_id = $2`,
      [id, userId],
    );
  },
  /** 删除计划行：联动 todos 由 FK on delete cascade 清掉（含已完成），
   * 执行记录 fitness_session_logs.plan_id 由 FK on delete set null 保留为独立打卡历史 */
  deletePlan(id: string, userId: string) {
    return pool.query(
      `delete from fitness_daily_plans where id = $1 and user_id = $2 returning id`,
      [id, userId],
    );
  },
  insertPlan(
    userId: string,
    d: { planDate: string; moduleCode: string; source: string; content: unknown; rationale: string | null; originConversationId: string | null },
    exec: Pick<typeof pool, "query"> = pool,
  ) {
    return exec.query(
      `insert into fitness_daily_plans (user_id, plan_date, module_code, source, content, rationale, origin_conversation_id)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7)
       returning id, user_id, plan_date::text as plan_date, module_code, source, status, content, rationale, origin_conversation_id`,
      [userId, d.planDate, d.moduleCode, d.source, JSON.stringify(d.content), d.rationale, d.originConversationId],
    );
  },
  /** extraWhere：附加 WHERE 条件（如 ` and status in ('draft','confirmed')`），供绕过行锁重读的
   * 写入点自限状态——锁外快照读后回写时防并发打卡后内容被覆盖 */
  updatePlan(id: string, userId: string, sets: string[], vals: unknown[], exec: Pick<typeof pool, "query"> = pool, extraWhere = "") {
    return exec.query(
      `update fitness_daily_plans set ${sets.join(", ")}, updated_at = now() where id = $${vals.length - 1} and user_id = $${vals.length}${extraWhere}
       returning id, user_id, plan_date::text as plan_date, module_code, source, status, content, rationale, origin_conversation_id`,
      vals,
    );
  },
  /** 训记同步状态（REQ-017）：localids 持久化，二次同步走更新防重复（训记 localid 实测为数字） */
  updateXunjiSync(id: string, userId: string, xunjiSync: { localids: Array<string | number>; syncedAt: string }) {
    return pool.query(
      `update fitness_daily_plans set xunji_sync = $3::jsonb, updated_at = now() where id = $1 and user_id = $2`,
      [id, userId, JSON.stringify(xunjiSync)],
    );
  },

  // ---- 执行记录 / 身体指标 ----
  listLogs(userId: string, from: string, to: string) {
    return pool.query(
      `select id, user_id, log_date::text as log_date, module_code, plan_id, actual, fatigue, sleep_h_x10, soreness, note
       from fitness_session_logs where user_id = $1 and log_date between $2 and $3
       order by log_date desc, created_at desc, id desc`,
      [userId, from, to],
    );
  },
  insertLog(
    userId: string,
    d: { logDate: string; moduleCode: string; planId: string | null; actual: unknown; fatigue: number | null; soreness: string | null; note: string | null },
    exec: Pick<typeof pool, "query"> = pool,
  ) {
    // 睡眠不在打卡里存（REQ-024 移至 fitness_sleep_logs）；列保留供历史行读取
    return exec.query(
      `insert into fitness_session_logs (user_id, log_date, module_code, plan_id, actual, fatigue, soreness, note)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       returning id, user_id, log_date::text as log_date, module_code, plan_id, actual, fatigue, sleep_h_x10, soreness, note`,
      [userId, d.logDate, d.moduleCode, d.planId, JSON.stringify(d.actual ?? {}), d.fatigue, d.soreness, d.note],
    );
  },
  listMetrics(userId: string, from: string, to: string) {
    return pool.query(
      `select id, user_id, measured_on::text as measured_on, weight_g, waist_mm, body_fat_pct_x10, height_mm, resting_hr, note
       from fitness_body_metrics where user_id = $1 and measured_on between $2 and $3 order by measured_on`,
      [userId, from, to],
    );
  },
  /** 同日行优先、否则最近一条早于 measuredOn 的指标行：saveMetric 留空字段继承旧值用
   *  （UI 承诺「留空的项保持原值不被清除」；身高体脂可只在变化时记录）。
   *  exec 可传事务 client：saveMetric 的读旧值+upsert 需在 per-user advisory lock 内串行 */
  latestMetricAtOrBefore(userId: string, measuredOn: string, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(
      `select weight_g, waist_mm, body_fat_pct_x10, height_mm, resting_hr, note
       from fitness_body_metrics
       where user_id = $1 and measured_on <= $2
       order by (measured_on = $2) desc, measured_on desc
       limit 1`,
      [userId, measuredOn],
    );
  },
  upsertMetric(
    userId: string,
    d: { measuredOn: string; weightG: number | null; waistMm: number | null; bodyFatPctX10: number | null; heightMm: number | null; restingHr: number | null; note: string | null },
    exec: Pick<typeof pool, "query"> = pool,
  ) {
    return exec.query(
      `insert into fitness_body_metrics (user_id, measured_on, weight_g, waist_mm, body_fat_pct_x10, height_mm, resting_hr, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (user_id, measured_on) do update set
         weight_g = excluded.weight_g, waist_mm = excluded.waist_mm,
         body_fat_pct_x10 = excluded.body_fat_pct_x10, height_mm = excluded.height_mm,
         resting_hr = excluded.resting_hr, note = excluded.note, updated_at = now()
       returning id, user_id, measured_on::text as measured_on, weight_g, waist_mm, body_fat_pct_x10, height_mm, resting_hr, note`,
      [userId, d.measuredOn, d.weightG, d.waistMm, d.bodyFatPctX10, d.heightMm, d.restingHr, d.note],
    );
  },

  // ---- 睡眠（REQ-024 每日独立记录；教练调整协议的数据源）----

  listSleep(userId: string, from: string, to: string) {
    return pool.query(
      `select log_date::text as log_date, sleep_h_x10, feeling, score, source from fitness_sleep_logs
       where user_id = $1 and log_date between $2 and $3 order by log_date`,
      [userId, from, to],
    );
  },
  upsertSleep(userId: string, logDate: string, sleepHX10: number, source: "manual" | "checkin", feeling?: string | null, score?: number | null, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(
      `insert into fitness_sleep_logs (user_id, log_date, sleep_h_x10, feeling, score, source)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, log_date) do update set
         sleep_h_x10 = excluded.sleep_h_x10,
         -- 感受/得分缺省时保留已有值（打卡兼容路径只带时长，不抹掉白天录的主观项）
         feeling = coalesce(excluded.feeling, fitness_sleep_logs.feeling),
         score = coalesce(excluded.score, fitness_sleep_logs.score),
         source = excluded.source, updated_at = now()
       returning id, log_date::text as log_date, sleep_h_x10, feeling, score, source`,
      [userId, logDate, sleepHX10, feeling ?? null, score ?? null, source],
    );
  },

  // ---- 动作库 ----
  listExercises(moduleCode: string | null) {
    return pool.query(
      `select * from fitness_exercises where ($1::text is null or module_code = $1) order by sort, id`,
      [moduleCode],
    );
  },
  /** 按名称匹配动作库（解析结果挂 exerciseId）：精确 → 蛋壳包含（去掉常见前后缀）。
   * like 通配符（% _ \）转义：动作名含 % 时裸拼会把「包含匹配」放大成「全表匹配」；
   * 精确分支与 like 分支分参——精确匹配仍用原名 */
  matchExercises(names: string[]) {
    const esc = (n: string) => n.replace(/[\\%_]/g, (c) => `\\${c}`);
    return pool.query(
      `select id, name from fitness_exercises
       where name = any($1::text[])
          or exists (select 1 from unnest($2::text[]) n where fitness_exercises.name like '%' || n || '%' escape '\\')`,
      [names, names.map(esc)],
    );
  },

  // ---- 训记动作目录快照（REQ-022 单行缓存表；分层加载见 service.loadXunjiCatalog） ----

  /** 读目录快照（单行设计：无行返回 null） */
  getXunjiCatalog() {
    return pool.query(`select movements, fetched_at from fitness_xunji_catalog where id = 1`);
  },
  /** 外呼刷新成功后写回（movements 为规范化后的 [{name, type, exetype, aliases}]） */
  upsertXunjiCatalog(movements: unknown[]) {
    return pool.query(
      `insert into fitness_xunji_catalog (id, movements, fetched_at) values (1, $1::jsonb, now())
       on conflict (id) do update set movements = excluded.movements, fetched_at = now()`,
      [JSON.stringify(movements)],
    );
  },

  // ---- 训记动作映射（REQ-023 用户确认的 拾光名 → 训记官方名）----

  listXunjiAliases(userId: string) {
    return pool.query(
      `select local_name, official_name from fitness_xunji_aliases where user_id = $1`,
      [userId],
    );
  },
  /** 确认弹窗提交后落库（冲突更新：同名改选覆盖旧映射） */
  upsertXunjiAliases(userId: string, entries: { localName: string; officialName: string }[]) {
    if (!entries.length) return Promise.resolve({ rowCount: 0 });
    return pool.query(
      `insert into fitness_xunji_aliases (user_id, local_name, official_name)
       select $1, x.local_name, x.official_name
       from unnest($2::text[], $3::text[]) as x(local_name, official_name)
       on conflict (user_id, local_name) do update set official_name = excluded.official_name`,
      [userId, entries.map((e) => e.localName), entries.map((e) => e.officialName)],
    );
  },

  // ---- 今日行动联动（todos.fitness_plan_id）----

  /** 用户的活动分类挂「健身」（预设 id='fitness'；用户可能没有该行（如测试直插 profiles）——查不到返回 null，todos.activity_id 允许空） */
  fitnessActivityId(userId: string) {
    return pool.query(
      `select id from activities where user_id = $1 and (id = 'fitness' or name = '健身') limit 1`,
      [userId],
    );
  },

  /** 删除该计划所有未完成联动行动（已完成行动保留作历史）。
   * pending 父任务被删时 parent_todo_id 的 on delete cascade 会连带删掉其下 done 子行动
   * （完成记录物理丢失 + 重建时以同名 pending 复活）——先把挂在 pending 父上的 done 子行动
   * 解挂（parent_todo_id 置 null），返回解挂行 id 供 syncPlanTodos 重建父任务后回挂。 */
  async deletePendingPlanTodos(planId: string, exec: Pick<typeof pool, "query"> = pool) {
    const { rows: unhooked } = await exec.query(
      `update todos set parent_todo_id = null
        where fitness_plan_id = $1 and status = 'done'
          and parent_todo_id in (select id from todos where fitness_plan_id = $1 and status = 'pending')
        returning id`,
      [planId],
    );
    await exec.query(`delete from todos where fitness_plan_id = $1 and status = 'pending'`, [planId]);
    return { unhookedIds: (unhooked as { id: string }[]).map((r) => r.id) };
  },
  /** 把解挂的 done 子行动回挂到新父任务（完成历史保持嵌套在计划父任务下） */
  reparentTodos(parentId: string, childIds: string[], exec: Pick<typeof pool, "query"> = pool) {
    if (childIds.length === 0) return Promise.resolve({ rowCount: 0 });
    return exec.query(`update todos set parent_todo_id = $1 where id = any($2::uuid[])`, [parentId, childIds]);
  },
  /** 该计划已完成的联动行动（title→行）：syncPlanTodos 重建时同名跳过、父任务复用旧 id——
   * 否则「保存后勾掉 2 个动作再确认计划」会把已打卡动作以新 pending 行复制出来（同义重复） */
  donePlanTodos(planId: string, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(
      `select id, title from todos where fitness_plan_id = $1 and status = 'done'`,
      [planId],
    );
  },
  /** 插入一条联动行动；返回行 id。strength 父任务 kind='todo'，其余 kind='action'。
   * activityId 动态解析（预设 'fitness' 或重命名/删除后的 null——activity_id 可空，不因缺行挂掉计划保存） */
  insertPlanTodo(
    userId: string,
    d: { planId: string; title: string; dueAtIso: string; source: "ai" | "manual"; kind: "todo" | "action"; parentId: string | null; sort: number; activityId: string | null; spaceId: string | null },
    exec: Pick<typeof pool, "query"> = pool,
  ) {
    return exec.query(
      `insert into todos (user_id, title, activity_id, due_at, remind_at, source, kind, parent_todo_id, sort, fitness_plan_id, space_id)
       values ($1, $2, $3::text, $4::timestamptz, $4::timestamptz - interval '15 minutes', $5, $6, $7, $8, $9, $10::uuid)
       returning id`,
      [userId, d.title, d.activityId, d.dueAtIso, d.source, d.kind, d.parentId, d.sort, d.planId, d.spaceId],
    );
  },
  /** 用户的内置运动空间 id（REQ-018：训练联动行动挂运动空间，出现在其 TODO·行动栏）；无则 null */
  sportSpaceId(userId: string) {
    return pool.query(`select id from goal_spaces where user_id = $1 and kind = 'sport' limit 1`, [userId]);
  },
  /** 打卡完成：该计划的未完成联动行动全部置完成 */
  completePlanTodos(planId: string, exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(
      `update todos set status = 'done', done_at = now()
       where fitness_plan_id = $1 and status = 'pending'`,
      [planId],
    );
  },
  countPlanTodos(planId: string) {
    return pool.query(
      `select count(*)::int as n from todos where fitness_plan_id = $1`,
      [planId],
    );
  },
};
