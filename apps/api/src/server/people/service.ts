/**
 * people 域 service（REQ-004 批③ / 4-C）：联系人档案、往来事件、AI 交往画像的业务与错误语义。
 * 迁移自 contacts / interactions / ai-profile 路由：校验文案与状态码逐字保留
 * （同名 400、农历生日 400、亲密度/重要度 400、画像空记录 400、AI 失败 502 等）。
 */
import { CONTACT_GROUPS, INTERACTION_TYPES } from "@shiguangri/shared/social";
import { chat, extractJson, hasApiKey, activeModel } from "@shiguangri/ai";
import { ApiError } from "../platform/http/errors";
import { isValidCalendarDate } from "../platform/http/datetime";
import { checkAiQuota, writeAuditRecord, type AuditRecord } from "../ai";
import { contactsRepo, interactionsRepo, peopleMoneyRepo } from "./repo";

interface ContactUpsertBody {
  name?: string;
  alias?: string | null;
  group?: string;
  birthday?: string | null;
  birthdayCal?: "solar" | "lunar";
  lunarMonth?: number;
  lunarDay?: number;
  lunarLeap?: boolean;
  anniversary?: string | null;
  importance?: number;
  notes?: string | null;
  intimacy?: number;
}

/** 生日/纪念日校验：只验形状会放行 2024-13-01 穿透 date 列 → PG 500。
 * 显式传入非法日期按 400 拒绝（与同域「农历生日需选择月和日」等 400 语义一致）；
 * 空/缺省仍置 null 保持宽松 */
const dateOrNull = (v?: string | null) => {
  if (!v) return null;
  if (!isValidCalendarDate(v)) throw ApiError.badRequest("日期需为真实存在的日期（YYYY-MM-DD）");
  return v;
};

/** 农历月/日取值域钳制 */
const lunarMonthOf = (v?: number) =>
  ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as number[]).includes(v as number) ? (v as number) : null;
const lunarDayOf = (v?: number) => (v != null && v >= 1 && v <= 30 ? (v as number) : null);

/** GET /api/contacts —— 联系人列表（含互动次数/最近往来/人情往来净额） */
export async function listContacts(userId: string) {
  const { rows } = await contactsRepo.listWithStats(userId);
  return { contacts: rows };
}

/** POST /api/contacts —— 手动建档 */
export async function createContact(userId: string, body: ContactUpsertBody) {
  if (body.name != null && typeof body.name !== "string") throw ApiError.badRequest("姓名需为字符串");
  const name = body.name?.trim();
  if (!name) throw ApiError.badRequest("姓名必填");
  if (name.length > 30) throw ApiError.badRequest("姓名过长");
  const group = body.group && (CONTACT_GROUPS as readonly string[]).includes(body.group) ? body.group : "朋友";
  const importance = [1, 2, 3, 4, 5].includes(body.importance as number) ? (body.importance as number) : 3;

  // 生日历法：农历存 lunar_*（birthday 置空），阳历存 birthday
  const isLunar = body.birthdayCal === "lunar";
  const lunarMonth = lunarMonthOf(body.lunarMonth);
  const lunarDay = lunarDayOf(body.lunarDay);
  if (isLunar && (!lunarMonth || !lunarDay)) {
    throw ApiError.badRequest("农历生日需选择月和日");
  }

  try {
    const created = (
      await contactsRepo.create(userId, {
        name,
        alias: body.alias?.trim() || null,
        group,
        birthday: isLunar ? null : dateOrNull(body.birthday),
        birthdayCal: isLunar ? "lunar" : "solar",
        lunarMonth: isLunar ? lunarMonth : null,
        lunarDay: isLunar ? lunarDay : null,
        lunarLeap: isLunar ? !!body.lunarLeap : false,
        anniversary: dateOrNull(body.anniversary),
        importance,
        notes: body.notes?.trim() || null,
      })
    ).rows[0];
    return { contact: created };
  } catch (e) {
    if (e instanceof ApiError) throw e; // dateOrNull 等校验的 400 不落 upstream（与 updateContact 同模式）
    if (String(e).includes("contacts_user_id_name_key")) {
      throw ApiError.badRequest(`已有联系人「${name}」`);
    }
    throw ApiError.upstream("服务器内部错误", String(e));
  }
}

/** GET /api/contacts/:id —— TA 的档案：基本信息 + 往来时间线 + 关联人情账 */
export async function contactDetail(userId: string, id: string) {
  const contact = await contactsRepo.detailById(id, userId);
  if (!contact) throw ApiError.notFound("联系人不存在");

  const timeline = (await contactsRepo.timelineOf(id)).rows;
  const money = (await contactsRepo.moneyOf(userId, contact.name)).rows;

  return { contact, timeline, money };
}

/** PATCH /api/contacts/:id —— 编辑档案 */
export async function updateContact(userId: string, id: string, body: ContactUpsertBody) {
  const fields: Array<[string, unknown]> = [];
  if (body.name != null && typeof body.name !== "string") throw ApiError.badRequest("姓名需为字符串");
  if (body.name?.trim()) {
    if (body.name.trim().length > 30) throw ApiError.badRequest("姓名过长");
    fields.push(["name", body.name.trim()]);
  }
  if (body.alias !== undefined) {
    if (body.alias !== null && typeof body.alias !== "string") throw ApiError.badRequest("备注名需为字符串");
    fields.push(["alias", body.alias?.trim() || null]);
  }
  if (body.group && (CONTACT_GROUPS as readonly string[]).includes(body.group)) {
    fields.push(["group_tag", body.group]);
  }
  // 生日历法整体切换：农历存 lunar_*（birthday 置空）、阳历存 birthday（lunar_* 清空）
  if (body.birthdayCal !== undefined) {
    const isLunar = body.birthdayCal === "lunar";
    if (isLunar) {
      const lm = lunarMonthOf(body.lunarMonth);
      const ld = lunarDayOf(body.lunarDay);
      if (!lm || !ld) throw ApiError.badRequest("农历生日需选择月和日");
      fields.push(["birthday_cal", "lunar"]);
      fields.push(["lunar_month", lm]);
      fields.push(["lunar_day", ld]);
      fields.push(["lunar_leap", !!body.lunarLeap]);
      fields.push(["birthday", null]);
    } else {
      fields.push(["birthday_cal", "solar"]);
      fields.push(["lunar_month", null]);
      fields.push(["lunar_day", null]);
      fields.push(["lunar_leap", false]);
    }
  }
  if (body.birthday !== undefined && body.birthdayCal !== "lunar") {
    fields.push(["birthday", dateOrNull(body.birthday)]);
  }
  if (body.anniversary !== undefined) {
    fields.push(["anniversary", dateOrNull(body.anniversary)]);
  }
  if (body.intimacy != null) {
    if (!Number.isInteger(body.intimacy) || body.intimacy < 0 || body.intimacy > 100) {
      throw ApiError.badRequest("亲密度需为 0~100 整数");
    }
    fields.push(["intimacy", body.intimacy]);
  }
  if (body.importance != null) {
    if (![1, 2, 3, 4, 5].includes(body.importance)) {
      throw ApiError.badRequest("重要程度需为 1~5 的整数");
    }
    fields.push(["importance", body.importance]);
  }
  if (body.notes !== undefined) {
    fields.push(["notes", body.notes?.trim() || null]);
  }
  if (fields.length === 0) throw ApiError.badRequest("没有可更新的字段");

  try {
    const updated = (await contactsRepo.updateFields(id, userId, fields)).rows[0];
    if (!updated) throw ApiError.notFound("联系人不存在");
    return { contact: updated };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (String(e).includes("contacts_user_id_name_key")) {
      throw ApiError.badRequest(`已有联系人「${body.name?.trim()}」`);
    }
    throw ApiError.upstream("服务器内部错误", String(e));
  }
}

/** DELETE /api/contacts/:id —— 删除联系人（往来事件级联删除，动态本体与流水不受影响） */
export async function deleteContact(userId: string, id: string) {
  const deleted = (await contactsRepo.remove(id, userId)).rows[0];
  if (!deleted) throw ApiError.notFound("联系人不存在");
  return { ok: true as const };
}

/** GET /api/contacts/:id/interactions —— 该联系人的往来列表（时间倒序，QA 验收补齐） */
export async function listInteractions(userId: string, contactId: string) {
  const contact = await contactsRepo.existsById(contactId, userId);
  if (!contact) throw ApiError.notFound("联系人不存在");
  const { rows } = await interactionsRepo.listByContact(userId, contactId);
  return { interactions: rows };
}

export interface InteractionBody {
  type?: string;
  summary?: string | null;
  occurredAt?: string;
}

/** POST /api/contacts/:id/interactions —— 手动补一笔往来 */
export async function createInteraction(userId: string, contactId: string, body: InteractionBody) {
  const contact = await contactsRepo.existsById(contactId, userId);
  if (!contact) throw ApiError.notFound("联系人不存在");

  const type = (INTERACTION_TYPES as readonly string[]).includes(body.type ?? "") ? body.type! : "其他";
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (isNaN(occurredAt.getTime())) {
    throw ApiError.badRequest("时间格式不正确");
  }

  const created = (
    await interactionsRepo.create(userId, contactId, type, body.summary?.trim() || null, occurredAt.toISOString())
  ).rows[0];
  return { interaction: created };
}

/** PATCH /api/interactions/:id —— 修正往来记录（type/summary/occurredAt；QA 验收补齐） */
export async function updateInteraction(userId: string, id: string, body: InteractionBody) {
  const vals: unknown[] = [];
  const sets: string[] = [];
  if (body.type !== undefined) {
    if (!(INTERACTION_TYPES as readonly string[]).includes(body.type)) {
      throw ApiError.badRequest("无效的往来类型");
    }
    vals.push(body.type);
    sets.push(`type = $${vals.length}`);
  }
  if (body.summary !== undefined) {
    vals.push(body.summary?.trim() || null);
    sets.push(`summary = $${vals.length}`);
  }
  if (body.occurredAt !== undefined) {
    const t = new Date(body.occurredAt);
    if (isNaN(t.getTime())) throw ApiError.badRequest("时间格式不正确");
    vals.push(t.toISOString());
    sets.push(`occurred_at = $${vals.length}`);
  }
  if (sets.length === 0) {
    throw ApiError.badRequest("没有可更新的字段");
  }
  const updated = (await interactionsRepo.updateFields(id, userId, sets, vals)).rows[0];
  if (!updated) throw ApiError.notFound("往来记录不存在");
  return { interaction: updated };
}

/** DELETE /api/interactions/:id —— 删除识别错的人际往来关联（不动联系人档案本身） */
export async function deleteInteraction(userId: string, id: string) {
  const deleted = (await interactionsRepo.remove(id, userId)).rows[0];
  if (!deleted) throw ApiError.notFound("往来记录不存在");
  return { ok: true as const };
}

interface AiProfile {
  summary: string;
  likes: string[];
  dislikes: string[];
  facts: string[];
}

/** date/timestamptz 列（node-pg → Date 对象）→ 北京日历日串：String(Date) 得 "Wed Sep 23..." 脏串
 * 且随宿主时区漂移，统一 +8h 归一化后再切日（与 finance/debt 同口径）；字符串入参按 YYYY-MM-DD 前缀取 */
const bjDateStr = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return new Date(v.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** GET /api/contacts/:id/ai-profile —— 只读已缓存的画像（不触发 AI；QA 验收补齐） */
export async function cachedAiProfile(userId: string, id: string) {
  const row = await contactsRepo.aiProfileOf(id, userId);
  if (!row) throw ApiError.notFound("联系人不存在");
  return { profile: row.ai_profile ?? null, generatedAt: row.ai_profile_at ?? null };
}

/**
 * POST /api/contacts/:id/ai-profile —— 基于往来记录提炼「AI 交往画像」（W10 遗留）
 * 只依据真实记录（往来时间线 + 人情账 + 档案备注），禁止编造；结果缓存于 contacts.ai_profile
 */
export async function generateAiProfile(userId: string, id: string) {
  // 配额门槛（M3）：与 trading 复盘等 AI 入口同语义——免费用户 30 天窗口额度用尽直接 402，不打 LLM
  const q = await checkAiQuota(userId);
  if (!q.allowed) {
    throw new ApiError(402, "quota", `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限提炼`);
  }
  if (!hasApiKey()) throw new ApiError(503, "upstream", "未配置 AI 服务");

  const contact = await contactsRepo.profileInputById(id, userId);
  if (!contact) throw ApiError.notFound("联系人不存在");

  const interactions = (await interactionsRepo.recentForProfile(id, userId)).rows;
  const money = (await peopleMoneyRepo.recentForProfile(contact.name, userId)).rows;

  if (interactions.length === 0 && money.length === 0 && !contact.notes) {
    throw ApiError.badRequest("还没有与 TA 的往来记录，先记几条动态或补一笔往来再来提炼");
  }

  const lines = [
    `人物：${contact.name}${contact.alias ? `（备注名 ${contact.alias}）` : ""}，分组 ${contact.group_tag}`,
    // birthday 是 date 列（Date 对象）：直接内插得 "Wed Sep 23..." 脏串，必须先归一化成北京日历日
    contact.birthday ? `生日 ${bjDateStr(contact.birthday)}` : "",
    contact.notes ? `档案备注：${contact.notes}` : "",
    interactions.length
      ? `往来记录（最近 ${interactions.length} 条）：\n${interactions
          .map((i: Record<string, unknown>) => `- [${i.type}] ${i.summary ?? ""}${i.occurred_at ? `（${bjDateStr(i.occurred_at)}）` : ""}`)
          .join("\n")}`
      : "",
    money.length
      ? `人情往来（最近 ${money.length} 笔）：\n${money
          .map((m: Record<string, unknown>) => `- ${m.direction === "out" ? "送出" : "收到"} ¥${(Number(m.amount_cents) / 100).toFixed(0)} ${m.note || m.category || ""}`)
          .join("\n")}`
      : "",
  ].filter(Boolean);

  const system = `你是个人经营助手，帮用户提炼与某位联系人的「交往画像」。只依据给出的真实记录归纳，**严禁编造**记录里没有的信息；记录太少就少说，每类最多 3 条。严格输出 JSON：
{
  "summary": "一句话交往风格总结（≤40字，基于记录）",
  "likes": ["TA 明显喜欢/在意的事（来自记录）"],
  "dislikes": ["TA 的忌讳/反感/雷区（来自记录，没有就空数组）"],
  "facts": ["值得记住的重要事实（如家人生日、口味、约定）"]
}`;

  // 审计计量（成本监控，与 decompose/trading 复盘同落 audit_logs）；writeAuditRecord 内部自兜底，绝不抛错
  const t0 = Date.now();
  const audit = (ok: boolean, error?: string) =>
    writeAuditRecord({
      userId,
      entryId: id,
      // audit_logs.stage 为自由文本列；AuditRecord 联合类型归 ai 域维护、暂未收录 ai_profile，
      // 这里经 string 断言写入新 stage（getQuota 只按 parse/review/asr 计费，ai_profile 不占免费额度）
      stage: "ai_profile" as string as AuditRecord["stage"],
      model: activeModel(),
      engine: "ai_profile",
      latencyMs: Date.now() - t0,
      textLen: lines.join("\n").length,
      ok,
      error: error ?? null,
    });

  let profile: AiProfile;
  try {
    const raw = await chat({
      system,
      user: lines.join("\n"),
      temperature: 0.3,
      maxTokens: 600,
      timeoutMs: 45_000,
    });
    const parsed = extractJson(raw) as Partial<AiProfile>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 3) : []);
    profile = {
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 60) : "记录还太少，多记几次再来提炼会更准",
      likes: arr(parsed.likes),
      dislikes: arr(parsed.dislikes),
      facts: arr(parsed.facts),
    };
  } catch (e) {
    await audit(false, String(e).slice(0, 300));
    // 固定文案：原始错误只进服务端日志/审计，不随 502 外泄（与 decompose 路由同口径）
    console.warn(`[ai-profile] 提炼失败: ${String(e).slice(0, 300)}`);
    throw new ApiError(502, "upstream", "AI 提炼失败，请稍后重试");
  }
  await audit(true);

  const updated = (
    await contactsRepo.setAiProfile(id, userId, JSON.stringify(profile))
  ).rows[0];

  return { profile: updated.ai_profile, profileAt: updated.ai_profile_at };
}
