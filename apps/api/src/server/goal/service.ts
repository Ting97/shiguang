/**
 * goal 域 service（REQ-004 FR-B1 / 4-C）：待办/行动、目标空间、空间感悟。
 * 路由迁移批③：原 7 个路由的主体逻辑逐字下沉（校验顺序、错误文案、返回体均与迁移前一致），
 * SQL 全部走 ./repo；错误统一 ApiError（基座映射后 error 文案与状态码不变，code 为新增字段）。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "../platform/http/errors";
import { isParsableMoment, isValidCalendarDate } from "../platform/http/datetime";
import { isUuid } from "../platform/http/validate";
import type { TodoItem, TodoRow } from "@shiguangri/shared/types";
import { todoRepo, spaceRepo, reflectionRepo } from "./repo";

export interface TodoCreateInput {
  title?: string;
  activityId?: string;
  parentId?: string;
  important?: boolean;
  today?: boolean;
  dueAt?: string | null; // ISO；null/缺省=无时间（之后行内编辑补充）
  note?: string | null; // 行动描述内容（≤1000 字）
  spaceId?: string | null;
  afterId?: string | null;
  repeatDaily?: boolean;
  kind?: "todo" | "action"; // N6 行动解耦：kind='action' 且不传 parentId = 独立行动
}

export interface TodoPatchInput {
  done?: boolean;
  undone?: boolean;
  title?: string;
  dueAt?: string | null; // ISO；null=清除时间
  startAt?: string | null; // ISO；null=清除起始（区间 todo 用）
  activityId?: string;
  important?: boolean; // ⭐ 重要标记（仅顶层任务，行动随父）
  today?: boolean; // ☀️ 今日标记：true=北京今天，false=清除（跨零点自动失效）
  note?: string | null; // 行动描述内容（≤1000 字；null=清除）
  spaceId?: string | null; // 目标空间归属（null=移除归属）
  repeatDaily?: boolean; // 🔁 每日重复（仅行动）
}

export interface SpaceCreateInput {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  startedAt?: string;
  targetDate?: string;
}

export interface SpacePatchInput {
  name?: string;
  description?: string | null;
  icon?: string;
  color?: string;
  startedAt?: string | null;
  targetDate?: string | null;
  status?: string;
  sort?: number;
}

// ---------------------------------------------------------------------------
// 待办 / 行动
// ---------------------------------------------------------------------------

/** 智能列表视图：today=今日标记 / important=⭐ / all=全部未完成 / done=已完成 / today-actions=首页今日行动清单（行动级） */
async function listTodos(userId: string, view: string) {
  // 06:00 日切恢复必须先于计数（重复行动次日回到未完成，counts.done 才不与列表状态矛盾）
  await todoRepo.restoreRepeating(userId);

  const countRows = await todoRepo.counts(userId);
  const counts = {
    today: countRows[0]?.today ?? 0,
    important: countRows[0]?.important ?? 0,
    all: countRows[0]?.all_pending ?? 0,
    done: countRows[0]?.done ?? 0,
  };

  if (view === "today-actions") {
    const { rows } = await todoRepo.todayActions(userId);
    return { actions: rows, counts };
  }

  const { rows: parents } = await todoRepo.parentsOfView(userId, view);

  let todos: TodoItem[] = parents.map((p) => ({ ...p, children: [] }));
  if (parents.length > 0) {
    const ids = parents.map((p) => p.id);
    const { rows: kids } = await todoRepo.childrenOf(userId, ids);
    const byParent = new Map<string, TodoRow[]>(parents.map((p) => [p.id, []]));
    for (const k of kids) byParent.get(k.parent_todo_id)?.push(k);
    todos = parents.map((p) => ({ ...p, children: byParent.get(p.id) ?? [] }));
  }

  return { todos, counts };
}

/**
 * POST /api/todos —— 手动新增待办/行动：只需标题，不做时间控制（due_at 留空，
 * 时间感由「无时间」标签呈现，之后仍可在待办行内编辑里补充）。
 * - parentId 建行动（最多一层）；important/today 直接带标记（仅顶层）
 * - spaceId 关联目标空间（校验属主）
 * - afterId 插入式定位（AI 拆解/手动插入）：新行动排在 afterId 行动之后，后续行动 sort 平移
 * - repeatDaily 每日重复（仅行动；06:00 日切惰性恢复）
 */
async function createTodo(userId: string, body: TodoCreateInput) {
  const title = (body.title ?? "").trim();
  if (!title) throw ApiError.badRequest("标题不能为空");
  if (title.length > 200) throw ApiError.badRequest("标题太长了（≤200 字）");
  const note = body.note?.trim() ? body.note.trim() : null;
  if (note && note.length > 1000) throw ApiError.badRequest("详情内容太长了（≤1000 字）");
  const kind = body.kind === "action" ? "action" : "todo";

  // 行动：校验父属主 + 最多一层（父自身不得再有 parent、须 kind='todo' 且未完成）；行动空间缺省继承父待办
  let parentId: string | null = null;
  let parentSpaceId: string | null = null;
  if (body.parentId) {
    // 引用字段 uuid 预检：非 uuid 落 SQL 触发 PG 22P02 cast 500，先拦成 400
    if (!isUuid(body.parentId)) throw ApiError.badRequest("parentId 参数不合法");
    const hit = await todoRepo.topTodoOf(body.parentId, userId);
    if (!hit) throw ApiError.badRequest("只能给未完成的顶层 todo 添加行动");
    parentId = hit.id;
    parentSpaceId = hit.space_id ?? null;
  }

  // 空间归属：显式指定校验属主；行动未显式指定时继承父待办
  let spaceId: string | null = null;
  if (body.spaceId) {
    // 引用字段 uuid 预检（同 parentId：非 uuid 落 SQL 会 22P02 → 500）
    if (!isUuid(body.spaceId)) throw ApiError.badRequest("spaceId 参数不合法");
    const hit = await spaceRepo.ownedId(body.spaceId, userId);
    if (!hit) throw ApiError.badRequest("空间不存在");
    spaceId = hit.id;
  } else if (parentId && body.spaceId === undefined) {
    spaceId = parentSpaceId;
  }

  // 分类：显式指定且属于该用户则用之，否则回退「其他」；再没有就置空（前端显示 📌）。
  // 注意 activities.id 是 text、预设分类本就是非 uuid（'sleep'…），不能做 isUuid 预检；
  // 不存在的 id 经 activityOwned 查空后静默回退「其他」（原有语义）
  let activityId: string | null = null;
  if (body.activityId) {
    const hit = await todoRepo.activityOwned(body.activityId, userId);
    activityId = hit.rows[0]?.id ?? null;
  }
  if (!activityId) {
    const other = await todoRepo.fallbackActivity(userId);
    activityId = other.rows[0]?.id ?? null;
  }

  // 标记只作用于顶层任务（行动随父走）：today=true 写入北京今天的日期
  const marked = !parentId;
  const dueAt = body.dueAt ?? null;
  // 语义校验前置（QA：非法串曾穿透到 new Date/::timestamptz → Invalid Date 抛 RangeError/PG 500）
  if (dueAt != null && !isParsableMoment(dueAt)) {
    throw ApiError.badRequest("dueAt 需为合法时间（ISO 格式，如 2025-06-01T09:00）");
  }

  // 行动插入式定位：afterId（同父行动）之后插入，后续行动 sort 平移；无 afterId 追加尾部
  let sort: number;
  if (parentId) {
    if (body.afterId) {
      // 引用字段 uuid 预检（同 parentId：非 uuid 落 SQL 会 22P02 → 500）
      if (!isUuid(body.afterId)) throw ApiError.badRequest("afterId 参数不合法");
      const anchor = await todoRepo.sortAnchor(body.afterId, userId, parentId);
      if (!anchor) throw ApiError.badRequest("插入位置不存在");
      await todoRepo.shiftSortAfter(userId, parentId, anchor.sort);
      sort = anchor.sort + 1;
    } else {
      const max = await todoRepo.maxSort(userId, parentId);
      sort = max.m + 1;
    }
  } else {
    sort = 0;
  }

  const todo = (
    await todoRepo.insert(userId, {
      title,
      activityId,
      parentId,
      important: marked && body.important ? true : false,
      markToday: marked && !!body.today,
      dueAt,
      remindAt: dueAt ? new Date(new Date(dueAt).getTime() - 15 * 60_000).toISOString() : null,
      note,
      spaceId,
      sort,
      repeatDaily: parentId || kind === "action" ? body.repeatDaily === true : false,
      kind: parentId ? "action" : kind,
    })
  ).rows[0];
  return { todo };
}

/** PATCH 模式零：恢复为未完成（撤销完成状态；历史版本完成时生成过日程块，一并删除） */
async function undoDoneTodo(userId: string, id: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const todo = await todoRepo.findDone(client, id, userId);
    if (!todo) {
      await client.query("rollback");
      throw ApiError.notFound("todo 不存在或未完成");
    }
    if (todo.done_block_id) await todoRepo.deleteDoneBlock(client, todo.done_block_id);
    const restored = (await todoRepo.restore(client, id)).rows[0];
    await client.query("commit");
    return { todo: restored };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e instanceof ApiError) throw e;
    // detail 只进日志（route 基座不回传），PG 原始错误串不下发客户端
    throw ApiError.upstream("服务器内部错误", String(e));
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/todos/:id —— { done: true } 勾选完成；{ undone: true } 恢复；或传字段修改待办
 * 模式一：勾选完成（仅改状态；日程与待办解耦，完成不再生成时间块）
 * 模式二：修改字段（今日/重要标记只作用于顶层任务；每日重复仅对行动生效）
 */
async function updateTodo(userId: string, id: string, body: TodoPatchInput) {
  if (body.undone === true) return undoDoneTodo(userId, id);

  if (body.done === true) {
    const todo = (await todoRepo.markDone(id, userId)).rows[0];
    if (!todo) throw ApiError.notFound("todo 不存在或已完成");
    return { todo };
  }

  // 今日/重要标记只作用于顶层任务（行动的上下文随父，避免「标记了却不出现在视图」的困惑）
  if (body.important !== undefined || body.today !== undefined) {
    const isChild = (await todoRepo.parentOf(id, userId))?.parent_todo_id;
    if (isChild) throw ApiError.badRequest("行动不支持单独标记，请标记父 todo");
  }
  // 每日重复仅对行动生效（kind='action'，N6 后含独立行动；顶层待办不设重复）
  if (body.repeatDaily !== undefined) {
    const kind = (await todoRepo.kindOf(id, userId))?.kind;
    if (kind !== "action") throw ApiError.badRequest("每日重复仅支持行动");
  }
  // 空间归属校验（REQ-002 N1）：
  // ① 有父行动不可单独关联空间（409，随父 todo）；② 新关联/切换只允许 active 空间（400，归档空间可移除不可新挂）
  // ③ spaceId:null 移除关联恒允许
  let spaceId: string | null = null;
  if (body.spaceId) {
    const own = await todoRepo.parentOf(id, userId);
    if (own?.parent_todo_id) throw ApiError.conflict("行动随父 todo 关联空间，不可单独设置");
    // 引用字段 uuid 预检（非 uuid 落 SQL 会 22P02 → 500）
    if (!isUuid(body.spaceId)) throw ApiError.badRequest("spaceId 参数不合法");
    const hit = await todoRepo.spaceWithStatus(body.spaceId, userId);
    if (!hit) throw ApiError.badRequest("空间不存在");
    if (hit.status !== "active") throw ApiError.badRequest("空间已归档，不可新关联");
    spaceId = hit.id;
  }
  // note 长度校验（位置与迁移前一致：在字段映射、「没有可更新的字段」判定之前）
  if (body.note !== undefined) {
    const note = body.note?.trim() ? body.note.trim() : null;
    if (note && note.length > 1000) throw ApiError.badRequest("详情内容太长了（≤1000 字）");
  }
  // 时间入参语义校验（QA：非法串曾穿透 buildPatch 的 $n::timestamptz → PG 报错 500；null=清除时间恒合法）
  if (body.dueAt != null && !isParsableMoment(body.dueAt)) {
    throw ApiError.badRequest("dueAt 需为合法时间（ISO 格式，如 2025-06-01T09:00）");
  }
  if (body.startAt != null && !isParsableMoment(body.startAt)) {
    throw ApiError.badRequest("startAt 需为合法时间（ISO 格式，如 2025-06-01T09:00）");
  }
  // 引用字段存在性预检：activities.id 是 text、预设分类本就是非 uuid——isUuid 预检会把
  // 「改成为预设分类」误拦成 400；不存在的 id 落 buildPatch 的 activity_id = $n 才是 500 面
  // （FK 23503），先查属主拦成 400
  if (body.activityId != null) {
    const hit = await todoRepo.activityOwned(body.activityId, userId);
    if (!hit.rows[0]) throw ApiError.badRequest("activityId 不存在");
  }
  const { sets, vals } = todoRepo.buildPatch(body, spaceId);
  if (sets.length === 0) throw ApiError.badRequest("没有可更新的字段");
  vals.push(id, userId);
  const updated = await todoRepo.updateFields(id, userId, sets, vals);
  if (!updated) throw ApiError.notFound("todo 不存在");
  // N1：归属变更时带最新空间摘要，供行内徽标即时更新
  let space: { id: string; name: string; icon: string; color: string; status: string } | null = null;
  if (body.spaceId !== undefined && updated.space_id) {
    space = (await todoRepo.spaceSummary(updated.space_id, userId)) ?? null;
  }
  return { todo: updated, space };
}

/** DELETE /api/todos/:id —— 删除待办（已完成的也可删） */
async function removeTodo(userId: string, id: string) {
  const deleted = (await todoRepo.remove(id, userId)).rows[0];
  if (!deleted) throw ApiError.notFound("todo 不存在");
  return { ok: true, title: deleted.title };
}

export const todoService = { list: listTodos, create: createTodo, update: updateTodo, remove: removeTodo };

// ---------------------------------------------------------------------------
// 目标空间
// ---------------------------------------------------------------------------

const MAX_ACTIVE_SPACES = 20;

/** YYYY-MM-DD 真实日历日校验：只验形状会放行 2024-13-01 穿透 date 列 → PG 500。
 * 空/缺省归 null（=不设/清除）；显式传入非法值按 400 拒绝（不静默吞掉，避免「日期设了却消失」） */
function calendarDateOrNull(v: string | null | undefined, label: string): string | null {
  if (v == null || v === "") return null;
  if (!isValidCalendarDate(v)) throw ApiError.badRequest(`${label}需为真实存在的日期（YYYY-MM-DD，如 2024-13-01 非法）`);
  return v;
}

/** GET /api/spaces —— 空间列表（active 在前）+ 聚合统计：
 * todoTotal/todoDone（顶层待办）、actionTotal/actionDone（行动=子待办）、entryCount、reflectionCount（REQ-002 N2） */
async function listSpaces(userId: string) {
  const { rows } = await spaceRepo.listWithStats(userId);
  return { spaces: rows };
}

/** POST /api/spaces —— 创建空间；active 超过 20 个时 400（控制 AI 分类 prompt 长度与认知负担） */
async function createSpace(userId: string, body: SpaceCreateInput) {
  const { name, description, icon, color, startedAt, targetDate } = body;
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.length > 40) throw ApiError.badRequest("名称必填且不超过 40 字");
  const { rows: active } = await spaceRepo.countActive(userId);
  if (active[0].n >= MAX_ACTIVE_SPACES) {
    throw ApiError.badRequest(`进行中的空间已达 ${MAX_ACTIVE_SPACES} 个，请先归档`);
  }
  const started = calendarDateOrNull(startedAt, "开始日期");
  const target = calendarDateOrNull(targetDate, "目标日期");
  const { rows } = await spaceRepo.insert(userId, trimmed, description?.trim() || null, icon?.trim() || null, color ?? null, started, target);
  return { ok: true as const, space: rows[0] };
}

/** PATCH /api/spaces/:id —— 字段修改 + {status:'archived'|'active'} 归档/恢复 */
async function updateSpace(userId: string, id: string, body: SpacePatchInput) {
  const { name, description, icon, color, startedAt, targetDate, status, sort } = body;
  if (status !== undefined && status !== "active" && status !== "archived") {
    throw ApiError.badRequest("status 需为 active/archived");
  }
  if (name !== undefined && (!name.trim() || name.trim().length > 40)) {
    throw ApiError.badRequest("名称必填且不超过 40 字");
  }
  // sort 是 int 列："abc"/1.5 曾穿透 → PG cast 500；存在时必须为整数
  if (sort !== undefined && !Number.isInteger(sort)) {
    throw ApiError.badRequest("sort 需为整数");
  }
  const { rows } = await spaceRepo.update(id, userId, {
    name: name?.trim() ?? null,
    hasDescription: description !== undefined,
    description: description?.trim() || null,
    icon: icon?.trim() || null,
    color: color ?? null,
    hasStartedAt: startedAt !== undefined,
    startedAt: calendarDateOrNull(startedAt, "开始日期"),
    hasTargetDate: targetDate !== undefined,
    targetDate: calendarDateOrNull(targetDate, "目标日期"),
    status: status ?? null,
    sort: sort ?? null,
  });
  if (!rows[0]) throw ApiError.notFound("空间不存在");
  return { ok: true as const, space: rows[0] };
}

/** DELETE /api/spaces/:id —— 硬删空间 */
async function removeSpace(userId: string, id: string) {
  const { rowCount } = await spaceRepo.remove(id, userId);
  if (!rowCount) throw ApiError.notFound("空间不存在");
  return { ok: true as const };
}

export const spaceService = { list: listSpaces, create: createSpace, update: updateSpace, remove: removeSpace };

// ---------------------------------------------------------------------------
// 空间感悟
// ---------------------------------------------------------------------------

const MAX_CHARS = 50_000;

export interface ReflectionCreateInput {
  content?: string;
}

/** GET /api/spaces/:id/reflections —— 感悟列表（倒序；预览 300 字 + 字数） */
async function listReflections(userId: string, spaceId: string, limit: number, offset: number) {
  const own = await reflectionRepo.spaceOwned(spaceId, userId);
  if (!own) throw ApiError.notFound("空间不存在");
  const { rows } = await reflectionRepo.list(spaceId, limit, offset);
  const total = await reflectionRepo.totalOf(spaceId);
  return { items: rows, total };
}

/** POST /api/spaces/:id/reflections —— 新建感悟 { content }（路由以 201 返回） */
async function createReflection(userId: string, spaceId: string, body: ReflectionCreateInput) {
  const content = (body.content ?? "").trim();
  if (!content) throw ApiError.badRequest("感悟不能为空");
  if (content.length > MAX_CHARS) throw ApiError.badRequest("超出 50000 字上限");

  const own = await reflectionRepo.spaceOwned(spaceId, userId);
  if (!own) throw ApiError.notFound("空间不存在");

  const { rows } = await reflectionRepo.insert(userId, spaceId, content);
  return { reflection: rows[0] };
}

/** GET /api/spaces/:id/reflections/:rid —— 全文（编辑/展开时拉取） */
async function getReflection(userId: string, rid: string) {
  if (!(await reflectionRepo.ownOf(rid, userId))) throw ApiError.notFound("感悟不存在");
  return { reflection: await reflectionRepo.byId(rid) };
}

/** PATCH /api/spaces/:id/reflections/:rid —— 编辑 { content } */
async function updateReflection(userId: string, rid: string, body: ReflectionCreateInput) {
  if (!(await reflectionRepo.ownOf(rid, userId))) throw ApiError.notFound("感悟不存在");
  const content = (body.content ?? "").trim();
  if (!content) throw ApiError.badRequest("感悟不能为空");
  if (content.length > MAX_CHARS) throw ApiError.badRequest("超出 50000 字上限");

  const { rows } = await reflectionRepo.update(rid, content);
  return { reflection: rows[0] };
}

/** DELETE /api/spaces/:id/reflections/:rid —— 硬删 */
async function removeReflection(userId: string, rid: string) {
  if (!(await reflectionRepo.ownOf(rid, userId))) throw ApiError.notFound("感悟不存在");
  await reflectionRepo.remove(rid);
  return { ok: true as const };
}

export const reflectionService = {
  list: listReflections,
  create: createReflection,
  get: getReflection,
  update: updateReflection,
  remove: removeReflection,
};
