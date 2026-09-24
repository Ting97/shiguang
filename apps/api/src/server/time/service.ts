/**
 * time 域 service（REQ-004 批③ / 4-C）：时间块、分类、时长聚合的业务与错误语义。
 * 迁移自 blocks / activities / stats 路由：QA 语义逐字保留（重叠 409、语义日期 400、
 * 倒挂时间 400、预设分类不可删 400 等）；重叠 409 响应体含 conflict 对象，由
 * overlapPayload 组装、路由原样透出。
 */
import { findOverlap, overlapError } from "@/server/platform/db";
import { isParsableMoment, isValidCalendarDate } from "@/server/platform/http/datetime";
import { ApiError } from "../platform/http/errors";
import { activitiesRepo, blocksRepo, statsRepo } from "./repo";
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
  if (!body.title?.trim() || !body.startAt || !body.endAt || !body.activityId) {
    throw ApiError.badRequest("标题、起止时间、类别均必填");
  }
  // 注：activities.id 是 text、预设分类本就是非 uuid（'sleep'…）——不能做 isUuid 预检；
  // 不存在的 id 由下方 23503 FK 映射拦成 400
  // 语义校验前置（QA 验收修复：倒挂/非法时间曾触发 PG range 异常 → 500 空响应体）
  if (!isParsableMoment(body.startAt) || !isParsableMoment(body.endAt)) {
    throw ApiError.badRequest("起止时间格式不正确");
  }
  if (Date.parse(body.endAt) <= Date.parse(body.startAt)) {
    throw ApiError.badRequest("结束时间必须晚于开始时间");
  }
  const conflict = await findOverlap(userId, body.startAt, body.endAt);
  if (conflict) return { conflict };
  try {
    const block = (
      await blocksRepo.insert(userId, body.activityId, body.title.trim(), body.startAt, body.endAt)
    ).rows[0];
    return { block };
  } catch (e) {
    // 23503：activityId 不存在触发复合 FK time_blocks_activity_id_fkey，属可预期输入错误（与 updateBlock 的映射对齐）
    if (String(e).includes("time_blocks_activity_id_fkey")) throw ApiError.badRequest("类别不存在");
    mapBlockWriteError(e);
  }
}

/** PATCH /api/blocks/:id —— 修改时间块（标题/起止时间/类别）；新时间段不得与其他块重叠 */
export async function updateBlock(userId: string, id: string, body: BlockWriteBody): Promise<BlockWriteResult> {
  // 重叠校验：新起止与现有块（排除自身）
  const cur = await blocksRepo.timesOf(id, userId);
  if (!cur) throw ApiError.notFound("日程不存在");
  const newStart = body.startAt ?? cur.start_at;
  const newEnd = body.endAt ?? cur.end_at;
  // 语义校验前置（QA 验收修复：倒挂/非法时间曾触发 PG range 异常 → 500 空响应体）
  if ((body.startAt != null && !isParsableMoment(body.startAt)) || (body.endAt != null && !isParsableMoment(body.endAt))) {
    throw ApiError.badRequest("起止时间格式不正确");
  }
  if (Date.parse(newEnd) <= Date.parse(newStart)) {
    throw ApiError.badRequest("结束时间必须晚于开始时间");
  }
  // 注：activity_id 是 text 列，非 uuid 合法（预设分类）；不存在的 id 由 23503 FK 映射拦成 400
  const conflict = await findOverlap(userId, newStart, newEnd, id);
  if (conflict) return { conflict };

  const fields: Array<[string, unknown]> = [];
  if (body.title != null) fields.push(["title", body.title.trim()]);
  if (body.startAt != null) fields.push(["start_at", body.startAt]);
  if (body.endAt != null) fields.push(["end_at", body.endAt]);
  if (body.activityId != null) fields.push(["activity_id", body.activityId]);
  if (fields.length === 0) throw ApiError.badRequest("没有可更新的字段");

  let updated: Record<string, unknown> | undefined;
  try {
    updated = (await blocksRepo.updateFields(id, userId, fields)).rows[0];
  } catch (e) {
    const msg = String(e);
    if (msg.includes("time_blocks_activity_id_fkey")) throw ApiError.badRequest("类别不存在");
    mapBlockWriteError(e);
  }
  if (!updated) throw ApiError.notFound("日程不存在");
  return { block: updated };
}

/** DELETE /api/blocks/:id —— 删除时间块 */
export async function deleteBlock(userId: string, id: string) {
  const deleted = (await blocksRepo.remove(id, userId)).rows[0];
  if (!deleted) throw ApiError.notFound("日程不存在");
  return { ok: true as const };
}

/** GET /api/blocks/range?from=YYYY-MM-DD&to=YYYY-MM-DD —— 区间内原始时间块 */
export async function listBlocksInRange(userId: string, from: string, to: string) {
  assertDateRange(from, to);
  // 按「区间与查询日期有交集」取：跨天块在其覆盖的每一天都返回（前端按天钳制显示），
  // 避免开始日在前一天的凌晨占用段在当天不可见、却仍触发冲突拦截
  const { rows } = await blocksRepo.listRange(userId, TZ, from, to);
  return { blocks: rows };
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
  // NaN 防御：非整数 defaultMin 过 Math.min/max 仍得 NaN，直落 int 列 500（PATCH 路径同款在路由层 assertNumericBody）
  if (body.defaultMin != null && (typeof body.defaultMin !== "number" || !Number.isInteger(body.defaultMin))) {
    throw ApiError.badRequest("defaultMin 需为整数（分钟）");
  }

  try {
    const created = (
      await activitiesRepo.create(userId, {
        name,
        icon: body.icon?.trim() || "🏷",
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
  if (body.name != null) fields.push(["name", body.name.trim()]);
  if (body.icon != null) fields.push(["icon", body.icon.trim() || "🏷"]);
  if (body.color != null && /^#[0-9a-fA-F]{6}$/.test(body.color)) fields.push(["color", body.color]);
  if (body.defaultMin != null) fields.push(["default_min", Math.min(Math.max(body.defaultMin, 5), 720)]);
  if (fields.length === 0) throw ApiError.badRequest("没有可更新的字段");

  try {
    const updated = (await activitiesRepo.updateFields(id, userId, fields)).rows[0];
    if (!updated) throw ApiError.notFound("分类不存在");
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
  return { days: [...daysMap.values()], totals };
}
