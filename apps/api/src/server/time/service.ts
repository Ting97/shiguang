/**
 * time 域 service（REQ-004 批③ / 4-C）：时间块、分类、时长聚合的业务与错误语义。
 * 迁移自 blocks / activities / stats 路由：QA 语义逐字保留（重叠 409、语义日期 400、
 * 倒挂时间 400、预设分类不可删 400 等）；重叠 409 响应体含 conflict 对象，由
 * overlapPayload 组装、路由原样透出。
 */
import { findOverlap, overlapError, pool } from "@/server/platform/db";
import { isParsableMoment, isValidCalendarDate } from "@/server/platform/http/datetime";
import { ApiError } from "../platform/http/errors";
import { invalidateReviewCachesForOccurrence, invalidateAllReviewCaches } from "@/server/insight";
import { activitiesRepo, blocksRepo, statsRepo, hasReviewablesInRange } from "./repo";
import { seedPresetActivities } from "./seed";

/** 与既有日程重叠的冲突块（409 响应体里的 conflict 字段） */
export type BlockOverlap = { id: string; title: string; start_at: string; end_at: string };

/** 写入结果：成功给 block，重叠给 conflict（路由据此渲染 409） */
export type BlockWriteResult = { block: Record<string, unknown> } | { conflict: BlockOverlap };

/** 409 响应体（文案与 conflict 对象逐字保留） */
export function overlapPayload(c: BlockOverlap) {
  return { error: overlapError(c), conflict: c };
}

/** PG 容器为 UTC，按北京日期切分必须显式时区 */
const TZ = "Asia/Shanghai";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateRange(from: string, to: string) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw ApiError.badRequest("from/to 需为合法日期且 from ≤ to");
  }
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) {
    throw ApiError.badRequest("from/to 需为真实存在的日期（如 2025-13-01 非法）");
  }
  // 跨度上限（对齐 fitness rangeGuard）：无上限时 from=0001-01-01&to=9999-12-31 会回全量历史块、
  // stats 对每块开 generate_series，单请求即可拉爆响应体/聚合（前端最大跨度为年视图 365 天差）
  if (new Date(`${to}T00:00:00+08:00`).getTime() - new Date(`${from}T00:00:00+08:00`).getTime() > 366 * 86_400_000) {
    throw ApiError.badRequest("查询区间不能超过一年");
  }
}

/** 倒挂/非法时间落库时 PG 约束兜底（QA 验收修复语义；detail 只进日志不下发）。
 *  23P01：「一个时刻只做一件事」的 EXCLUDE 约束兜底——生产 PG13 缺 btree_gist（contrib 未装）
 *  暂未上线，约束就绪后自动生效；应用层 findOverlap 预检（409 文案）仍是主防线 */
function mapBlockWriteError(e: unknown, conflictTitle = "已有日程"): never {
  const msg = String(e);
  if (msg.includes("time_blocks_check") || msg.includes("end_at_start_at")) {
    throw ApiError.badRequest("结束时间必须晚于开始时间");
  }
  if (e instanceof ApiError) throw e;
  if (msg.includes("23P01") || msg.includes("time_blocks_no_overlap")) {
    throw ApiError.conflict(`该时间段已被占用（${conflictTitle}），一个时刻只能做一件事`);
  }
  throw ApiError.upstream("服务器内部错误", msg);
}

export interface BlockWriteBody {
  title?: string;
  startAt?: string; // ISO
  endAt?: string; // ISO
  activityId?: string;
}

/** POST /api/blocks —— 手动创建时间块（日视图缺口补录）；不允许与已有日程重叠 */
export async function createBlock(userId: string, body: BlockWriteBody): Promise<BlockWriteResult> {
  // title 先验类型再验内容：非字符串（{title:123}）走 .trim() 是 TypeError → 500，应 400
  if (body.title != null && typeof body.title !== "string") throw ApiError.badRequest("标题需为字符串");
  if (body.title != null && body.title.trim().length > 100) throw ApiError.badRequest("标题最长 100 字");
  if (!body.title?.trim() || !body.startAt || !body.endAt || !body.activityId) {
    throw ApiError.badRequest("标题、起止时间、类别均必填");
  }
  // 注：activities.id 是 text、预设分类本就是非 uuid（'sleep'…）——不能做 isUuid 预检；
  // 不存在的 id 由下方 23503 FK 映射拦成 400
  // 语义校验前置（QA 验收修复：倒挂/非法时间曾触发 PG range 异常 → 500 空响应体）
  if (!isParsableMoment(body.startAt) || !isParsableMoment(body.endAt)) {
    throw ApiError.badRequest("起止时间格式不正确");
  }
  // 归一为带 Z 的 UTC ISO 再落库：无时区偏移的串（2025-01-01T10:00）JS 校验按宿主时区解释、
  // PG 落库按 DB 会话时区解释，非 UTC 宿主上校验基准与存储值差 8 小时
  //（appendManual/confirmPending 构造时已显式带 +08:00，此处对手工路由补齐同口径）
  const startAt = new Date(body.startAt).toISOString();
  const endAt = new Date(body.endAt).toISOString();
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw ApiError.badRequest("结束时间必须晚于开始时间");
  }
  // 重叠预检与落库收进同一事务，事务首语句取 per-user advisory lock 串行化同用户时间块写路径：
  // 生产 PG13 缺 btree_gist 无 EXCLUDE 约束兜底（见文件头注），无锁时两条并发创建可同时通过预检
  // 各自落库（双重预约）；advisory lock 恒为首锁不改变既有「entry 行锁」顺序，无死锁面
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`timeblocks:${userId}`]);
    const conflict = await findOverlap(userId, startAt, endAt, undefined, undefined, client);
    if (conflict) {
      await client.query("rollback");
      return { conflict };
    }
    const block = (
      await blocksRepo.insert(userId, body.activityId, body.title.trim(), startAt, endAt, client)
    ).rows[0];
    await client.query("commit");
    // 补录历史时刻的块不抬 buildLatest 水位（只认 max(start_at)），当期缓存被误判「仍新鲜」
    // → 复盘长期缺这块——按块起始日显式失效四档缓存（十一轮 P2，与 deleteBlock 同口径）；
    // end_at 再失效一次：跨天块结束日分摊时长，起点失效覆盖不到结束日缓存（analyze 主路径同口径）
    void invalidateReviewCachesForOccurrence(userId, new Date(startAt));
    void invalidateReviewCachesForOccurrence(userId, new Date(endAt));
    return { block };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    // 23503：activityId 不存在触发复合 FK time_blocks_activity_id_fkey，属可预期输入错误（与 updateBlock 的映射对齐）
    if (String(e).includes("time_blocks_activity_id_fkey")) throw ApiError.badRequest("类别不存在");
    mapBlockWriteError(e);
  } finally {
    client.release();
  }
}

/** PATCH /api/blocks/:id —— 修改时间块（标题/起止时间/类别）；新时间段不得与其他块重叠 */
export async function updateBlock(userId: string, id: string, body: BlockWriteBody): Promise<BlockWriteResult> {
  // 语义校验前置（QA 验收修复：倒挂/非法时间曾触发 PG range 异常 → 500 空响应体）
  if ((body.startAt != null && !isParsableMoment(body.startAt)) || (body.endAt != null && !isParsableMoment(body.endAt))) {
    throw ApiError.badRequest("起止时间格式不正确");
  }
  // 归一为带 Z 的 UTC ISO 再落库（与 createBlock 同口径：无偏移串的宿主/会话时区双解释差 8 小时）
  const startIso = body.startAt != null ? new Date(body.startAt).toISOString() : undefined;
  const endIso = body.endAt != null ? new Date(body.endAt).toISOString() : undefined;
  // 注：activity_id 是 text 列，非 uuid 合法（预设分类）；不存在的 id 由 23503 FK 映射拦成 400
  const fields: Array<[string, unknown]> = [];
  if (body.title != null) {
    if (typeof body.title !== "string") throw ApiError.badRequest("标题需为字符串");
    if (!body.title.trim()) throw ApiError.badRequest("标题不能为空");
    if (body.title.trim().length > 100) throw ApiError.badRequest("标题最长 100 字");
    fields.push(["title", body.title.trim()]);
  }
  if (startIso != null) fields.push(["start_at", startIso]);
  if (endIso != null) fields.push(["end_at", endIso]);
  if (body.activityId != null) fields.push(["activity_id", body.activityId]);
  if (fields.length === 0) throw ApiError.badRequest("没有可更新的字段");

  // 与 createBlock 同款：重叠预检 + 更新同一事务 + advisory lock 串行化（TOCTOU 收口）
  const client = await pool.connect();
  let updated: Record<string, unknown> | undefined;
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`timeblocks:${userId}`]);
    // 基准读取收进锁内（同一 client）：锁外读的 cur 可能已被并发更新/删除，
    // 重叠预检与落库会基于过期基准（与 createBlock 同强度）
    const cur = await blocksRepo.timesOf(id, userId, client);
    if (!cur) throw ApiError.notFound("日程不存在");
    const newStart = startIso ?? cur.start_at;
    const newEnd = endIso ?? cur.end_at;
    // pg 返回的 timestamptz 是 Date 对象：Date.parse(Date) 依赖 toString 隐式转换（非标准、宿主相关），
    // instanceof 分支统一取 epoch 毫秒比较
    const epochMs = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d));
    if (epochMs(newEnd) <= epochMs(newStart)) {
      throw ApiError.badRequest("结束时间必须晚于开始时间");
    }
    const conflict = await findOverlap(userId, newStart, newEnd, id, undefined, client);
    if (conflict) {
      await client.query("rollback");
      return { conflict };
    }
    // 睡眠同步块任何编辑即解绑（REQ-038）：用户改过的块不再是纯同步产物——保留修改、
    // 置空链接；该日再次保存睡眠时生成独立新块（删除同理：删了不复活）
    if (cur.sleep_log_id != null) fields.push(["sleep_log_id", null]);
    updated = (await blocksRepo.updateFields(id, userId, fields, client)).rows[0];
    await client.query("commit");
    // 跨日改期会让旧日多计/新日漏计（水位只认 max(start_at) 且行还在不触发显式失效）——
    // 旧、新 start_at 各失效一次（十一轮 P2，与 deleteBlock 同口径）；旧、新 end_at 同理
    //（跨天块结束日分摊时长，只按 start_at 失效漏掉结束日缓存）
    void invalidateReviewCachesForOccurrence(userId, new Date(cur.start_at as string));
    void invalidateReviewCachesForOccurrence(userId, new Date(cur.end_at as string));
    void invalidateReviewCachesForOccurrence(userId, new Date(newStart as string));
    void invalidateReviewCachesForOccurrence(userId, new Date(newEnd as string));
  } catch (e) {
    await client.query("rollback").catch(() => {});
    const msg = String(e);
    if (msg.includes("time_blocks_activity_id_fkey")) throw ApiError.badRequest("类别不存在");
    mapBlockWriteError(e);
  } finally {
    client.release();
  }
  if (!updated) throw ApiError.notFound("日程不存在");
  return { block: updated };
}

/** DELETE /api/blocks/:id —— 删除时间块 */
export async function deleteBlock(userId: string, id: string) {
  const deleted = (await blocksRepo.remove(id, userId)).rows[0];
  if (!deleted) throw ApiError.notFound("日程不存在");
  // 删除会让复盘水位（max(start_at)）回退、当期缓存被判「仍新鲜」回旧数据——
  // 与 finance 删交易同口径，按块起始日显式失效四档复盘缓存（函数内部吞错降级，不阻塞删除）；
  // end_at 同失效（跨天块结束日缓存同样因水位回退而滞留已删数据）
  void invalidateReviewCachesForOccurrence(userId, new Date(deleted.start_at));
  void invalidateReviewCachesForOccurrence(userId, new Date(deleted.end_at));
  return { ok: true as const };
}

// ---- 睡眠同步日程块（REQ-038）：fitness 保存/打卡睡眠后调用，替换式幂等 ----

/** 睡眠同步入参：sleep log 主键 + 北京 log_date + 时长×10（0 = 撤销同步，仅删旧块） */
export interface SleepSyncInput {
  sleepLogId: string;
  logDate: string; // YYYY-MM-DD，语义为「X 日醒来的昨晚睡眠」
  sleepHX10: number;
}

/** ok=false 时睡眠数据已照常保存，仅日程段未写入（reason 为用户可读冲突文案） */
export type SleepSyncResult = { ok: true; blockId: string | null } | { ok: false; reason: string };

/** 起床锚点 07:00（北京）：块区间 = [log_date 07:00 − 时长, log_date 07:00]。
 *  起床时刻恒定、入睡随时长浮动（8h → 前夜 23:00，跨天块两日视图各显示所属段）；
 *  必须显式 +08:00（无偏移串会按宿主/会话时区双解释，差 8 小时） */
function sleepRangeOf(logDate: string, sleepHX10: number) {
  const endAt = new Date(`${logDate}T07:00:00+08:00`).toISOString();
  const startAt = new Date(Date.parse(endAt) - (sleepHX10 / 10) * 3_600_000).toISOString();
  return { startAt, endAt };
}

async function syncSleepBlockInner(
  userId: string,
  input: SleepSyncInput,
  exec: Pick<typeof pool, "query">,
): Promise<{ sync: SleepSyncResult; invalidateAts: Date[] }> {
  // 与 createBlock/updateBlock 同一把 per-user advisory lock：重叠预检与落库串行化（TOCTOU 收口）
  await exec.query(`select pg_advisory_xact_lock(hashtext($1))`, [`timeblocks:${userId}`]);
  // 「睡眠」预设分类必须存在（time_blocks 复合 FK 要求同用户行）：注册即播种 + 预设不可删，
  // 正常恒在；兜底缺失时跳过同步而非 23503 炸掉 fitness 打卡事务（与 067 回填守卫同口径）
  const hasAct = await exec.query(`select 1 from activities where id = 'sleep' and user_id = $1`, [userId]);
  if (!hasAct.rows.length) return { sync: { ok: false, reason: "缺少「睡眠」分类，无法生成日程段" }, invalidateAts: [] };
  const prev = (await blocksRepo.bySleepLog(userId, input.sleepLogId, exec)).rows[0] as
    | { id: string; start_at: string | Date; end_at: string | Date }
    | undefined;
  if (input.sleepHX10 <= 0) {
    const removed = (await blocksRepo.removeBySleepLog(userId, input.sleepLogId, exec)).rows;
    const invalidateAts = removed.flatMap((r) => [new Date(r.start_at), new Date(r.end_at)]);
    return { sync: { ok: true, blockId: null }, invalidateAts };
  }
  const { startAt, endAt } = sleepRangeOf(input.logDate, input.sleepHX10);
  // 先预检再删旧：冲突时保留旧同步段不丢，仅跳过并返回原因——下次改时长/清走冲突日程后可重试
  const conflict = await findOverlap(userId, startAt, endAt, prev?.id, undefined, exec);
  if (conflict) return { sync: { ok: false, reason: overlapError(conflict) }, invalidateAts: [] };
  await blocksRepo.removeBySleepLog(userId, input.sleepLogId, exec);
  const block = (await blocksRepo.insert(userId, "sleep", "睡眠", startAt, endAt, exec, input.sleepLogId)).rows[0];
  // 新旧区间各自的起止日都失效复盘缓存：替换可能跨日移动分摊时长（与 createBlock/deleteBlock 同口径）
  const invalidateAts = [prev?.start_at, prev?.end_at, startAt, endAt]
    .filter((d): d is string | Date => !!d)
    .map((d) => new Date(d));
  return { sync: { ok: true, blockId: block.id as string }, invalidateAts };
}

/** 保存/打卡睡眠后同步生成日程「😴 睡眠」跨天块（自开事务）。
 *  事务内路径用 syncSleepBlockInTx：复盘缓存失效必须在调用方 commit 之后触发——
 *  在事务内先行失效，失效删除与提交之间的复盘生成请求会以旧数据重建缓存且水位不变（缓存永久陈旧） */
export async function syncSleepBlock(userId: string, input: SleepSyncInput): Promise<SleepSyncResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { sync, invalidateAts } = await syncSleepBlockInner(userId, input, client);
    await client.query("commit");
    for (const at of invalidateAts) void invalidateReviewCachesForOccurrence(userId, at);
    return sync;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 事务内路径（fitness 打卡/补录：先持 plan 行锁再取 timeblocks advisory lock，锁序恒为
 *  plan → advisory，与只持 advisory 的建块路径无死锁面）；返回待失效事件时间，
 *  调用方在其事务 commit 后统一触发失效。 */
export async function syncSleepBlockInTx(
  userId: string,
  input: SleepSyncInput,
  exec: Pick<typeof pool, "query">,
): Promise<{ sync: SleepSyncResult; invalidateAts: Date[] }> {
  return syncSleepBlockInner(userId, input, exec);
}

/** GET /api/blocks/range?from=YYYY-MM-DD&to=YYYY-MM-DD —— 区间内原始时间块 */
export async function listBlocksInRange(userId: string, from: string, to: string) {
  assertDateRange(from, to);
  // 按「区间与查询日期有交集」取：跨天块在其覆盖的每一天都返回（前端按天钳制显示），
  // 避免开始日在前一天的凌晨占用段在当天不可见、却仍触发冲突拦截
  const { rows } = await blocksRepo.listRange(userId, TZ, from, to);
  // 复盘卡「有记录」口径：时间块之外还有动态/流水/完成 todo 也算有（与复盘管线取数同口径）
  const hasExtras = await hasReviewablesInRange(userId, TZ, from, to);
  return { blocks: rows, hasExtras };
}

export interface ActivityBody {
  name?: string;
  icon?: string;
  color?: string;
  defaultMin?: number;
}

/** GET /api/activities —— 全部分类（空则自愈播种，兜底早期注册的存量账号） */
export async function listActivities(userId: string) {
  let { rows } = await activitiesRepo.listByUser(userId);
  if (rows.length === 0) {
    await seedPresetActivities(userId);
    ({ rows } = await activitiesRepo.listByUser(userId));
  }
  return { activities: rows };
}

/** POST /api/activities —— 新增自定义分类 */
export async function createActivity(userId: string, body: ActivityBody) {
  if (body.name != null && typeof body.name !== "string") throw ApiError.badRequest("名称需为字符串");
  if (body.icon != null && typeof body.icon !== "string") throw ApiError.badRequest("图标需为字符串");
  const name = body.name?.trim();
  if (!name) throw ApiError.badRequest("名称必填");
  // 与 AI 契约 name≤20 同口径：分类名会逐条拼进识别 prompt 的 catList（无上限 = token 成本×N）
  if (name.length > 20) throw ApiError.badRequest("分类名最长 20 字");
  // NaN 防御：非整数 defaultMin 过 Math.min/max 仍得 NaN，直落 int 列 500（PATCH 路径同款在路由层 assertNumericBody）
  if (body.defaultMin != null && (typeof body.defaultMin !== "number" || !Number.isInteger(body.defaultMin))) {
    throw ApiError.badRequest("defaultMin 需为整数（分钟）");
  }

  try {
    const created = (
      await activitiesRepo.create(userId, {
        name,
        icon: body.icon?.trim().slice(0, 8) || "🏷",
        color: body.color != null && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#64748b",
        defaultMin: Math.min(Math.max(body.defaultMin ?? 30, 5), 720),
      })
    ).rows[0];
    return { activity: created };
  } catch (e) {
    if (String(e).includes("activities_user_id_name_key")) {
      throw ApiError.badRequest("已存在同名分类");
    }
    throw ApiError.upstream("服务器内部错误", String(e));
  }
}

/** PATCH /api/activities/:id —— 修改分类（名称/图标/颜色/默认时长） */
export async function updateActivity(userId: string, id: string, body: ActivityBody) {
  const fields: Array<[string, unknown]> = [];
  if (body.name != null && typeof body.name !== "string") throw ApiError.badRequest("名称需为字符串");
  if (body.icon != null && typeof body.icon !== "string") throw ApiError.badRequest("图标需为字符串");
  // 空名与 create 口径对齐（activities.name 仅 not null 无 check，空串会存出无名分类）
  if (body.name != null) {
    if (!body.name.trim()) throw ApiError.badRequest("名称必填");
    if (body.name.trim().length > 20) throw ApiError.badRequest("分类名最长 20 字");
    fields.push(["name", body.name.trim()]);
  }
  if (body.icon != null) fields.push(["icon", body.icon.trim().slice(0, 8) || "🏷"]);
  // 非法色显式 400（与 create 的默认色回落是两种入口语义；旧版静默忽略会让「仅改色」得到
  // 「没有可更新的字段」的误导性 400）
  if (body.color != null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) throw ApiError.badRequest("颜色格式需为 #RRGGBB");
    fields.push(["color", body.color]);
  }
  if (body.defaultMin != null) {
    if (typeof body.defaultMin !== "number" || !Number.isInteger(body.defaultMin)) {
      throw ApiError.badRequest("defaultMin 需为整数（分钟）");
    }
    fields.push(["default_min", Math.min(Math.max(body.defaultMin, 5), 720)]);
  }
  if (fields.length === 0) throw ApiError.badRequest("没有可更新的字段");

  try {
    const updated = (await activitiesRepo.updateFields(id, userId, fields)).rows[0];
    if (!updated) throw ApiError.notFound("分类不存在");
    // 改名/改图标影响复盘文本（直接消费 activities.name/icon），而新鲜度水位没有 activities 列——
    // 历史周期会被判「仍新鲜」而永久滞留旧名，整表失效靠惰性重建（invalidateAllReviewCaches 注释）
    if (fields.some(([col]) => col === "name" || col === "icon")) void invalidateAllReviewCaches(userId);
    return { activity: updated };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (String(e).includes("activities_user_id_name_key")) {
      throw ApiError.badRequest("已存在同名分类");
    }
    throw ApiError.upstream("服务器内部错误", String(e));
  }
}

/** DELETE /api/activities/:id —— 删除自定义分类（其时间块/待办归入"其他"）；预设分类不可删 */
export async function deleteActivity(userId: string, id: string) {
  const r = await activitiesRepo.deleteCustom(id, userId);
  if (r === "not_found") throw ApiError.notFound("分类不存在");
  if (r === "preset") throw ApiError.badRequest("预设分类不可删除（可修改名称/图标/颜色）");
  // 重挂「其他」改变统计归类口径 + 旧分类名从复盘文本消失：同 updateActivity 全量失效（水位无 activities 列）
  void invalidateAllReviewCaches(userId);
  return { ok: true as const, reassigned: true };
}

/** GET /api/stats/range?from=&to= —— 按日按类别的时长聚合（月视图/年热力图/趋势用） */
export async function activityStatsInRange(userId: string, from: string, to: string) {
  assertDateRange(from, to);

  // 按天交集钳制：跨天块（如昨晚23:00→今早07:00的睡眠）的时长分摊到它覆盖的每一天，
  // 与日视图/周视图的交集口径一致（旧实现按开始日归全长，跨天块会整段记在一天）
  const { rows } = await statsRepo.dailyMinsByActivity(userId, TZ, from, to);

  const daysMap = new Map<string, { date: string; totalMin: number; byActivity: Record<string, number> }>();
  const totals: Record<string, number> = {};
  for (const r of rows) {
    if (!daysMap.has(r.date)) daysMap.set(r.date, { date: r.date, totalMin: 0, byActivity: {} });
    const d = daysMap.get(r.date)!;
    d.byActivity[r.activity_id] = r.mins;
    d.totalMin += r.mins;
    totals[r.activity_id] = (totals[r.activity_id] ?? 0) + r.mins;
  }
  return { days: [...daysMap.values()], totals, hasExtras: await hasReviewablesInRange(userId, TZ, from, to) };
}
