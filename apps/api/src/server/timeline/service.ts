/**
 * timeline 域 service（REQ-004 FR-B1 / 4-C）：动态采集、五域识别编排、确认流。
 * timeline 是核心域：parse 编排持有识别产物落库的唯一入口（analyzeAndPersist），
 * confirm/edit 时清理并重写各域子表（四域域表写入的既有语义逐行保留）。
 * 批③并入 entry 子资源操作：手动补充产物、单域重识别、图片上传/删除、饮食删除、冲突警示关闭。
 */
import { pool, findOverlap, overlapError } from "@/server/platform/db";
import { ruleMood, parseInput, DOMAIN_LABELS, activeModel, toCstWallClock, type Domain, type ParseResult } from "@shiguangri/ai";
import { inferInteractionType } from "@shiguangri/shared/social";
import { checkAiQuota } from "@/server/ai/quota";
import { writeAuditRecord } from "../ai/audit";
import { assembleUserPrompt, getPromptBundle, type PromptKey } from "../ai/prompts";
import { deleteImageFile, sniffImageMime, IMAGE_MIME_EXT, newStorageKey, saveImageFile } from "@/server/timeline/storage";
import { ApiError } from "../platform/http/errors";
import { analyzeAndPersist, listContactNames } from "./analyze";
import { entriesRepo } from "./repo";

/** POST /api/parse：动态本体先落地秒回 + 配额 + 后台五域识别（fire-and-forget，成败都打 analyzed_at） */
export async function ingest(userId: string, text: string) {
  const q = await checkAiQuota(userId);
  if (!q.allowed) {
    throw ApiError.quota(
      `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限识别`,
      q,
    );
  }
  const entry = (await entriesRepo.insert(userId, "keyboard", text.trim())).rows[0];
  // FR-C2.4：识别失败不再打 analyzed_at（失败留痕由巡检补跑）；成功路径 analyzeAndPersist 内部落 analyzed_at
  void analyzeAndPersist(userId, entry.id, text.trim())
    .catch((e) => {
      console.error("[analyze] 后台识别失败（巡检将补跑）:", e);
      return pool.query(`update entries set analyze_retries = analyze_retries + 1 where id = $1`, [entry.id]);
    });
  return { entry };
}

/** POST /api/entries/:id/confirm {domain, ignore?}：确认 pending 识别落库；ignore=true 丢弃 */
export async function confirmPending(
  userId: string,
  entryId: string,
  domain: Domain | undefined,
  ignore = false,
) {
  if (!domain) throw ApiError.badRequest("domain 必填");
  const rec = await entriesRepo.pendingRecognition(entryId, userId, domain);
  if (!rec) throw ApiError.notFound("没有待确认的识别结果");

  if (ignore) {
    await entriesRepo.ignoreRecognition(rec.id);
    return { ok: true as const, domain, ignored: true };
  }

  const result = rec.result ?? {};
  const client = await pool.connect();
  try {
    await client.query("begin");
    // 事务内所有语句统一走 client（否则自动提交让 rollback 形同虚设，中途失败会静默丢数据）
    const entry = await entriesRepo.rawTextOf(entryId, userId, client);
    if (!entry) {
      await client.query("rollback");
      throw ApiError.notFound("动态不存在");
    }

    switch (domain) {
      case "mood": {
        if (result.label) {
          await client.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [
            result.label, result.score ?? 0, entryId,
          ]);
        }
        break;
      }
      case "schedule": {
        if (result.startAt && result.endAt && result.activityId && result.title) {
          await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await client.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,'default','keyboard')`,
            [userId, entryId, result.activityId, result.title, result.startAt, result.endAt],
          );
        }
        break;
      }
      case "todo": {
        if (result.dueAt && result.title) {
          await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await client.query(
            `insert into todos (user_id, entry_id, title, due_at, remind_at, source, space_id)
             values ($1,$2,$3,$4,$5,'keyboard',(select space_id from entries where id = $2))`,
            [userId, entryId, result.title, result.dueAt, new Date(new Date(result.dueAt).getTime() - 15 * 60_000).toISOString()],
          );
        }
        break;
      }
      case "finance": {
        if (result.amountCents != null) {
          await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await client.query(
            `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              userId, entryId,
              result.direction === "in" ? "in" : "out",
              Math.abs(result.amountCents),
              result.category ?? "其他",
              result.counterparty ?? null,
              entry.raw_text,
              result.occurredAt ?? new Date().toISOString(),
            ],
          );
        }
        break;
      }
      case "diet": {
        if (result.items?.length) {
          await client.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await client.query(
            `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
             values ($1,$2,$3,$4,$5)`,
            [userId, entryId, result.meal ?? "未知", JSON.stringify(result.items), result.totalKcal ?? null],
          );
        }
        break;
      }
    }

    await entriesRepo.applyRecognition(rec.id, client);
    await client.query("commit");
    return { ok: true as const, domain };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e instanceof ApiError) throw e;
    throw ApiError.upstream("确认失败", String(e).slice(0, 200));
  } finally {
    client.release();
  }
}

export interface FeedQuery {
  limit: number;
  offset: number;
  q: string;
  spaceId: string;
}

/** GET /api/feed：动态流（聚合五域产物/图片/识别登记簿；关键字检索；空间过滤） */
export async function listFeed(userId: string, query: FeedQuery) {
  const { limit, offset, q, spaceId } = query;
  let spaceSql = "";
  // 占位符动态取号：q 存在时检索 ilike 占用 $4，空间过滤顺延为 $5（避免双 $4 实参错位 → uuid 解析 500）
  const spaceParamIndex = q ? 5 : 4;
  if (spaceId === "none") spaceSql = ` and e.space_id is null`;
  else if (spaceId !== "all" && /^[0-9a-f-]{36}$/.test(spaceId)) spaceSql = ` and e.space_id = $${spaceParamIndex}::uuid`;

  const searchSql = q
    ? `and (
         e.raw_text ilike $4
         or exists (select 1 from time_blocks b where b.entry_id = e.id and b.title ilike $4)
         or exists (select 1 from todos t where t.entry_id = e.id and t.title ilike $4)
         or exists (select 1 from transactions x where x.entry_id = e.id
                    and (x.category ilike $4 or x.counterparty ilike $4 or x.note ilike $4))
         or exists (select 1 from interactions i join contacts c on c.id = i.contact_id
                    where i.entry_id = e.id and c.name ilike $4)
         or exists (select 1 from diet_records d where d.entry_id = e.id and d.items::text ilike $4)
       )`
    : "";

  const { rows } = await pool.query(
    `select e.id, e.raw_text, e.source, e.mood, e.mood_score, e.created_at, e.analyzed_at,
       case when e.analyzed_at is null and e.created_at < now() - interval '10 minutes' then 'timeout' end as recognize_state,
       (select jsonb_build_object('id', gs.id, 'name', gs.name, 'icon', gs.icon, 'color', gs.color)
          from goal_spaces gs where gs.id = e.space_id) as space,
       count(*) over () as total_count,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', b.id, 'title', b.title, 'startAt', b.start_at, 'endAt', b.end_at,
           'durationMin', b.duration_min, 'activityId', b.activity_id,
           'activityName', a.name, 'icon', a.icon, 'color', a.color
         ) order by b.start_at)
         from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
         where b.entry_id = e.id
       ), '[]') as blocks,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'dueAt', t.due_at, 'startAt', t.start_at, 'status', t.status, 'activityId', t.activity_id
         ) order by t.created_at)
         from todos t where t.entry_id = e.id
       ), '[]') as todos,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', x.id, 'amountCents', x.amount_cents, 'direction', x.direction,
           'category', x.category, 'counterparty', x.counterparty
         ))
         from transactions x where x.entry_id = e.id
       ), '[]') as transactions,
       coalesce((
         select jsonb_agg(jsonb_build_object('interactionId', i.id, 'name', c.name, 'summary', i.summary))
         from interactions i join contacts c on c.id = i.contact_id
         where i.entry_id = e.id
       ), '[]') as people,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', g.id, 'storageKey', g.storage_key, 'mime', g.mime, 'width', g.width, 'height', g.height, 'sort', g.sort
         ) order by g.sort, g.created_at)
         from entry_images g where g.entry_id = e.id
       ), '[]') as images,
       (select jsonb_build_object('id', d.id, 'meal', d.meal, 'items', d.items, 'totalKcal', d.total_kcal)
         from diet_records d where d.entry_id = e.id) as diet,
       coalesce((
         select jsonb_object_agg(rg.domain, jsonb_build_object(
           'status', rg.status, 'confidence', rg.confidence, 'reason', rg.result->>'reason', 'engine', rg.engine,
           'reasonDismissed', coalesce(rg.result->>'reasonDismissed', 'false')::boolean))
         from entry_recognitions rg where rg.entry_id = e.id
       ), '{}'::jsonb) as recognitions
     from entries e
     where e.user_id = $1 ${searchSql} ${spaceSql}
     order by e.created_at desc
     limit $2 offset $3`,
    q
      ? spaceId !== "all" && spaceId !== "none"
        ? [userId, limit, offset, `%${q.replace(/[\\%_]/g, "\\$&")}%`, spaceId]
        : [userId, limit, offset, `%${q.replace(/[\\%_]/g, "\\$&")}%`]
      : spaceId !== "all" && spaceId !== "none"
        ? [userId, limit, offset, spaceId]
        : [userId, limit, offset],
  );
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return { moments: rows, total };
}

export interface FeedPatch {
  mood?: string | null;
  raw_text?: string;
  spaceId?: string | null;
}

/** PATCH /api/feed/:id：手动归属空间 / 编辑原文重识别 / 修正心情（三选一语义互斥） */
export async function patchFeed(userId: string, entryId: string, body: FeedPatch) {
  // 手动归属空间：校验空间属主（null=移除归属）
  if (body.spaceId !== undefined) {
    let sid: string | null = null;
    if (body.spaceId) {
      const hit = await entriesRepo.spaceOwnerExists(body.spaceId, userId);
      if (!hit.rows[0]) throw ApiError.badRequest("空间不存在");
      sid = hit.rows[0].id;
    }
    const updated = (await entriesRepo.setSpace(entryId, userId, sid)).rows[0];
    if (!updated) throw ApiError.notFound("动态不存在");
    return { ok: true as const, entry: updated };
  }

  if (body.raw_text !== undefined) {
    const text = body.raw_text.trim();
    if (!text) throw ApiError.badRequest("内容不能为空");
    if (text.length > 2000) throw ApiError.badRequest("动态最长 2000 字");
    const q = await checkAiQuota(userId);
    if (!q.allowed) {
      throw ApiError.quota(`AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限识别`, q);
    }

    const client = await pool.connect();
    let updated;
    try {
      await client.query("begin");
      await entriesRepo.clearDerived(client, entryId, userId);
      updated = (await entriesRepo.editRawText(client, entryId, userId, text)).rows[0];
      if (!updated) {
        await client.query("rollback");
        throw ApiError.notFound("动态不存在");
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      if (e instanceof ApiError) throw e;
      throw ApiError.upstream("编辑失败", String(e).slice(0, 200));
    } finally {
      client.release();
    }
    // 后台全域重识别（同发动态：秒回 + fire-and-forget）；成功自打 analyzed_at，失败留巡检
    void analyzeAndPersist(userId, entryId, text)
      .catch((e) => console.error(`[analyze] entry ${entryId} 编辑重识别失败（巡检将补跑）:`, e));
    return { ok: true as const, entry: updated };
  }

  const label = body.mood?.trim() || null;
  const score = label ? (ruleMood(label)?.score ?? 0) : null;
  const updated = (await entriesRepo.setMoodByEntry(entryId, userId, label, score)).rows[0];
  if (!updated) throw ApiError.notFound("动态不存在");
  return { entry: updated };
}

type ManualDomain = "schedule" | "todo" | "finance" | "mood" | "diet" | "people";
const MANUAL_VALID: ManualDomain[] = ["schedule", "todo", "finance", "mood", "diet", "people"];
const RECOGNIZE_VALID = ["schedule", "todo", "finance", "mood", "diet", "people"] as const;

/**
 * POST /api/entries/:id/manual { domain, payload } —— 手动补充识别产物（不经 AI）
 * 六域各自落库并写登记簿（engine='manual'），来源动态在动态流中完整呈现。
 */
export async function appendManual(
  userId: string,
  entryId: string,
  body: { domain?: string; payload?: Record<string, unknown> },
) {
  const domain = body.domain as ManualDomain | undefined;
  const p = (body.payload ?? {}) as Record<string, any>;
  if (!domain || !MANUAL_VALID.includes(domain)) {
    throw ApiError.badRequest("domain 需为 schedule/todo/finance/mood/diet/people");
  }

  const entry = (
    await pool.query(`select id, raw_text, created_at from entries where id = $1 and user_id = $2`, [entryId, userId])
  ).rows[0];
  if (!entry) throw ApiError.notFound("动态不存在");

  const client = await pool.connect();
  try {
    await client.query("begin");
    let message = "";
    let result: unknown = {};

    switch (domain) {
      case "schedule": {
        const title = String(p.title ?? "").trim();
        if (!title || !p.startTime || !p.endTime) {
          throw ApiError.badRequest("需要标题与起止时间");
        }
        if (!/^\d{2}:\d{2}$/.test(String(p.startTime)) || !/^\d{2}:\d{2}$/.test(String(p.endTime))) {
          throw ApiError.badRequest("起止时间格式需为 HH:MM");
        }
        // 以动态创建日（北京日历日）为基准日拼接 HH:MM：UTC getter + 8h 推算，不依赖宿主时区；
        // 解析时显式追加 +08:00（无后缀的 ISO 串会按宿主时区解析，非 CST 宿主上会偏 8 小时）
        const base = new Date(entry.created_at);
        const day = new Date(base.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
        const start = new Date(`${day}T${p.startTime}:00+08:00`).toISOString();
        const end = new Date(`${day}T${p.endTime}:00+08:00`).toISOString();
        if (end <= start) {
          throw ApiError.badRequest("结束时间必须晚于开始时间");
        }
        const conflict = await findOverlap(userId, start, end);
        if (conflict) {
          throw ApiError.conflict(overlapError(conflict));
        }
        const activityId = typeof p.activityId === "string" && p.activityId ? p.activityId : "other";
        await client.query(
          `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
           values ($1,$2,$3,$4,$5,$6,'explicit','manual')`,
          [userId, entryId, activityId, title, start, end],
        );
        result = { title, start, end };
        message = `🕒 已手动添加日程「${title}」`;
        break;
      }
      case "todo": {
        const title = String(p.title ?? "").trim();
        if (!title) {
          throw ApiError.badRequest("标题不能为空");
        }
        const dueAt = p.dueAt ? new Date(String(p.dueAt)).toISOString() : null;
        const activityId = typeof p.activityId === "string" && p.activityId ? p.activityId : "other";
        await client.query(
          `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source, space_id)
           values ($1,$2,$3,$4,$5,$6,'manual',(select space_id from entries where id = $2))`,
          [userId, entryId, title, activityId, dueAt, dueAt ? new Date(new Date(dueAt).getTime() - 15 * 60_000) : null],
        );
        result = { title, dueAt };
        message = `📋 已手动添加 todo「${title}」`;
        break;
      }
      case "finance": {
        const yuan = Number(p.yuan);
        if (!Number.isFinite(yuan) || yuan <= 0) {
          throw ApiError.badRequest("金额需大于 0");
        }
        const direction = p.direction === "in" ? "in" : "out";
        await client.query(
          `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at, is_draft)
           values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
          [
            userId, entryId, direction, Math.round(yuan * 100),
            typeof p.category === "string" && p.category ? p.category : "其他",
            typeof p.counterparty === "string" && p.counterparty ? p.counterparty : null,
            entry.raw_text, new Date().toISOString(),
          ],
        );
        result = { direction, yuan };
        message = `💰 已手动添加${direction === "out" ? "支出" : "收入"} ¥${yuan}（待确认）`;
        break;
      }
      case "mood": {
        const label = typeof p.label === "string" ? p.label.trim() : "";
        if (!label) {
          throw ApiError.badRequest("请选择心情");
        }
        await client.query(`update entries set mood = $2, mood_score = $3 where id = $1`, [entryId, label, Number(p.score ?? 0)]);
        result = { label };
        message = `😊 已设置心情「${label}」`;
        break;
      }
      case "diet": {
        const text = typeof p.text === "string" ? p.text.trim() : "";
        if (!text) {
          throw ApiError.badRequest("请填写吃了什么");
        }
        const meal = ["早餐", "午餐", "晚餐", "加餐", "夜宵", "未知"].includes(String(p.meal)) ? String(p.meal) : "未知";
        const kcal = Number.isFinite(Number(p.kcal)) && Number(p.kcal) > 0 ? Number(p.kcal) : null;
        await client.query(
          `insert into diet_records (user_id, entry_id, meal, items, total_kcal) values ($1,$2,$3,$4,$5)`,
          [userId, entryId, meal, JSON.stringify([{ name: text.slice(0, 40), amount: null, kcal }]), kcal],
        );
        result = { meal, text, kcal };
        message = `🍽 已手动添加饮食「${text}」`;
        break;
      }
      case "people": {
        const name = typeof p.name === "string" ? p.name.trim() : "";
        if (!name) {
          throw ApiError.badRequest("请填写姓名");
        }
        const type = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"].includes(String(p.type)) ? String(p.type) : "见面";
        const c = (
          await client.query(
            `insert into contacts (user_id, name) values ($1, $2)
             on conflict (user_id, name) do update set name = excluded.name returning id`,
            [userId, name],
          )
        ).rows[0];
        await client.query(
          `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [userId, c.id, entryId, type, entry.raw_text.slice(0, 60), new Date().toISOString()],
        );
        result = { name, type };
        message = `👥 已记录与「${name}」的往来`;
        break;
      }
    }

    // 登记簿：手动添加标记为 applied + manual
    await client.query(
      `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
       values ($1,$2,$3,'applied',$4,1,'manual')
       on conflict (entry_id, domain) do update set
         status = 'applied', result = excluded.result, confidence = 1,
         engine = 'manual', updated_at = now()`,
      [userId, entryId, domain, JSON.stringify(result ?? {})],
    );

    await client.query("commit");
    return { ok: true as const, message };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e instanceof ApiError) throw e;
    throw ApiError.upstream("手动添加失败", String(e).slice(0, 200));
  } finally {
    client.release();
  }
}

function confidenceOf(r: ParseResult, domain: string): number {
  switch (domain) {
    case "people": return 0.9;
  }
  switch (domain as Domain) {
    case "schedule": return r.scheduleConfidence;
    case "todo": return r.todoConfidence;
    case "finance": return r.financeConfidence;
    case "mood": return r.mood.confidence;
    case "diet": return r.diet.confidence;
  }
  return 0.9;
}

/**
 * POST /api/entries/:id/recognize { domain } —— 单域重新识别（替换式）
 * mood: 覆写/清空 | schedule: 冲突检测通过才换块 | todo/finance: 删旧落新 | diet: upsert
 */
export async function reRecognize(userId: string, entryId: string, domain?: string) {
  const q = await checkAiQuota(userId);
  if (!q.allowed) {
    throw ApiError.quota(
      `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限识别`,
      q,
    );
  }
  if (!domain || !RECOGNIZE_VALID.includes(domain as Domain | "people")) {
    throw ApiError.badRequest("domain 需为 schedule/todo/finance/mood/diet/people");
  }

  const entry = (
    await pool.query(`select id, raw_text from entries where id = $1 and user_id = $2`, [entryId, userId])
  ).rows[0];
  if (!entry) throw ApiError.notFound("动态不存在");

  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  // 输入装配（3-A）：单域 key 按 DB 配置组装 user prompt；people 域联系人受开关控制
  const key = `extract_domain_${domain}` as PromptKey;
  const bundle = await getPromptBundle(key);
  const contactsOn = domain === "people" && bundle.config.inject.contactList;
  const contactNames = contactsOn ? await listContactNames(userId, bundle.config.caps.contactCount) : undefined;
  const contactList =
    contactsOn && contactNames && contactNames.length
      ? `\n已有联系人（人物识别时称呼对齐到名单原文）：${contactNames.join("、")}`
      : "";
  const userPrompt = await assembleUserPrompt(key, bundle, {
    nowCst: toCstWallClock(new Date()),
    contactList,
    text: entry.raw_text,
  }, { userId });
  const r: ParseResult = await parseInput(entry.raw_text, {
    domain, // 单域专属提示词：只判本域，更准更省
    contactNames,
    systemPrompt: bundle.system,
    userPrompt,
    onUsage: (u) => {
      // 历史消耗口径：修复重问等多轮调用逐次累加，不取最后一次
      promptTokens += u.prompt_tokens;
      completionTokens += u.completion_tokens;
    },
  });
  // 整次重识别一行审计：tokens 为历次 LLM 调用合计（含修复重问）；降级但已耗 token 时如实归属模型
  void writeAuditRecord({
    userId, entryId, stage: "parse",
    model: r.engine !== "rules" || promptTokens > 0 ? activeModel() : null,
    engine: r.engine,
    latencyMs: Date.now() - t0, ok: true,
    promptTokens, completionTokens,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    let applied = false;
    let result: unknown = null;
    let message = "";

    switch (domain) {
      case "mood": {
        applied = !!r.mood.label;
        result = r.mood;
        await client.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [
          applied ? r.mood.label : null,
          applied ? r.mood.score : null,
          entryId,
        ]);
        message = applied ? `😊 识别到心情：${r.mood.label}` : "未识别出心情，已清除原心情";
        break;
      }
      case "schedule": {
        if (!r.scheduleApplicable || r.intent === "todo") {
          // 识别不出：删旧块，动态变纯动态
          await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [entryId, userId]);
          result = { reason: "未识别出日程" };
          message = "未识别出日程，已移除原日程块";
          break;
        }
        // 冲突检测在删旧块之前做，但必须排除本 entry 自身旧块（重识别为替换式，
        // 否则命中自己的旧块永远 409）。走事务 client 查询：entry_id 可空（on delete set null），
        // 用 is distinct from 同时排除多条自有块且保留 NULL entry_id 的他人块检测。
        const conflict = (
          await client.query(
            `select id, title, start_at, end_at
               from time_blocks
              where user_id = $1
                and entry_id is distinct from $4::uuid
                and tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
              order by start_at
              limit 1`,
            [userId, r.time.start, r.time.end, entryId],
          )
        ).rows[0] ?? null;
        if (conflict) {
          throw ApiError.conflict(
            overlapError(conflict, { title: r.title, start: r.time.start, end: r.time.end }),
          );
        }
        await client.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [entryId, userId]);
        const block = (
          await client.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,$7,'keyboard') returning *`,
            [userId, entryId, r.activity, r.title, r.time.start, r.time.end, r.time.mode],
          )
        ).rows[0];
        applied = true;
        result = { blockId: block.id, title: r.title, startAt: r.time.start, endAt: r.time.end };
        message = `🕒 日程已更新：${r.title}`;
        break;
      }
      case "todo": {
        await client.query(`delete from todos where entry_id = $1 and user_id = $2`, [entryId, userId]);
        if (r.intent === "todo") {
          const remind = new Date(new Date(r.time.start).getTime() - 15 * 60_000);
          const todo = (
            await client.query(
              `insert into todos (user_id, entry_id, title, activity_id, due_at, remind_at, source, space_id)
               values ($1,$2,$3,$4,$5,$6,'keyboard',(select space_id from entries where id = $2)) returning id`,
              [userId, entryId, r.title, r.activity, r.time.start, remind.toISOString()],
            )
          ).rows[0];
          applied = true;
          result = { todoId: todo.id, title: r.title };
          message = `📋 todo 已更新：${r.title}`;
        } else {
          result = { reason: "未识别出 todo" };
          message = "未识别出 todo，已移除原 todo";
        }
        break;
      }
      case "finance": {
        await client.query(`delete from transactions where entry_id = $1 and user_id = $2`, [entryId, userId]);
        if (r.finance.hasAmount && r.finance.amountCents != null) {
          await client.query(
            `insert into transactions (user_id, entry_id, direction, amount_cents, category, counterparty, note, occurred_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              userId, entryId,
              r.finance.direction === "in" ? "in" : "out",
              Math.abs(r.finance.amountCents),
              r.finance.category ?? "其他",
              r.finance.counterparty ?? null,
              entry.raw_text,
              r.time.end,
            ],
          );
          applied = true;
          result = r.finance;
          message = `💰 收支已更新：¥${(Math.abs(r.finance.amountCents) / 100).toFixed(0)}`;
        } else {
          result = { reason: "未识别出金额" };
          message = "未识别出收支，已移除原流水";
        }
        break;
      }
      case "diet": {
        await client.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [entryId, userId]);
        if (r.diet.applicable && r.diet.items.length > 0) {
          await client.query(
            `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
             values ($1,$2,$3,$4,$5)`,
            [userId, entryId, r.diet.meal, JSON.stringify(r.diet.items), r.diet.totalKcal ?? null],
          );
          applied = true;
          result = r.diet;
          const kcal = r.diet.totalKcal != null ? ` · ≈${r.diet.totalKcal} kcal` : "";
          message = `🍽 饮食已更新：${r.diet.meal}${kcal}`;
        } else {
          result = { reason: "未识别出饮食" };
          message = "未识别出饮食记录";
        }
        break;
      }
      case "people": {
        // 关系域：删旧往来，按解析结果重建（精确名/别名命中已有联系人则复用，避免称呼变体重建档）
        await client.query(`delete from interactions where entry_id = $1 and user_id = $2`, [entryId, userId]);
        let added = 0;
        for (const p of r.people) {
          const hit = await client.query(
            `select id from contacts where user_id = $1 and (name = $2 or alias = $2) limit 1`,
            [userId, p.name],
          );
          const contactId = hit.rows[0]
            ? hit.rows[0].id
            : (
                await client.query(
                  `insert into contacts (user_id, name) values ($1, $2)
                   on conflict (user_id, name) do update set name = excluded.name returning id`,
                  [userId, p.name],
                )
              ).rows[0].id;
          const summary = p.event ? (p.event === r.title ? p.event : `${p.event}：${r.title}`) : r.title;
          await client.query(
            `insert into interactions (user_id, contact_id, entry_id, type, summary, occurred_at)
             values ($1,$2,$3,$4,$5,$6)`,
            [userId, contactId, entryId, inferInteractionType(p.event), summary, r.time.end],
          );
          added++;
        }
        applied = added > 0;
        result = { people: r.people };
        message = added > 0 ? `👥 关系已更新（${added} 人）` : "未识别出人物，已移除原关联";
        break;
      }
    }

    await client.query(
      `insert into entry_recognitions (user_id, entry_id, domain, status, result, confidence, engine)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (entry_id, domain) do update set
         status = excluded.status, result = excluded.result,
         confidence = excluded.confidence, engine = excluded.engine, updated_at = now()`,
      [userId, entryId, domain, applied ? "applied" : "none", JSON.stringify(result ?? {}), confidenceOf(r, domain), r.engine],
    );

    await client.query("commit");
    return { ok: true as const, applied, domain, message: `${domain === "people" ? "关系" : DOMAIN_LABELS[domain as Domain]}：${message}` };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e instanceof ApiError) throw e;
    throw ApiError.upstream("重识别失败", String(e).slice(0, 200));
  } finally {
    client.release();
  }
}

const MAX_PER_ENTRY = 9;
const MAX_BYTES = 5 * 1024 * 1024; // 压缩后兜底上限

/**
 * POST /api/entries/:id/images —— 发布文字动态后并行上传图片（formData 字段 files，多文件）
 * 校验：登录 → entry 属主 → 单条 ≤9 张（含已有）→ 单张 ≤5MB → 魔数白名单；写盘 + 落库（事务）
 */
export async function addEntryImages(userId: string, entryId: string, form: FormData) {
  const entry = (
    await pool.query(`select id from entries where id = $1 and user_id = $2`, [entryId, userId])
  ).rows[0];
  if (!entry) throw ApiError.notFound("动态不存在");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw ApiError.badRequest("没有文件");

  const { rows: existing } = await pool.query(
    `select count(*)::int as n from entry_images where entry_id = $1 and user_id = $2`,
    [entryId, userId],
  );
  const have = existing[0].n;
  if (have + files.length > MAX_PER_ENTRY) {
    throw ApiError.badRequest(`单条动态最多 ${MAX_PER_ENTRY} 张（已有 ${have} 张）`);
  }

  // 逐一校验（大小 + 魔数），全部通过才落库
  const prepared: { mime: string; bytes: number; data: Buffer; key: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      throw ApiError.badRequest(`单张图片不能超过 5MB`);
    }
    const data = Buffer.from(await f.arrayBuffer());
    const sniffed = sniffImageMime(data);
    if (!sniffed || !(sniffed in IMAGE_MIME_EXT)) {
      throw ApiError.badRequest("仅支持 jpg/png/webp/gif 图片");
    }
    prepared.push({ mime: sniffed, bytes: data.length, data, key: newStorageKey(sniffed) });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted: { id: string; storageKey: string; mime: string; width: number | null; height: number | null; sort: number }[] = [];
    let sort = have; // 追加到已有图片之后
    for (const p of prepared) {
      const { rows } = await client.query(
        `insert into entry_images (user_id, entry_id, storage_key, mime, bytes, width, height, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, storage_key, mime, width, height, sort`,
        [userId, entryId, p.key, p.mime, p.bytes, null, null, sort++],
      );
      const r = rows[0];
      inserted.push({ id: r.id, storageKey: r.storage_key, mime: r.mime, width: r.width, height: r.height, sort: r.sort });
    }
    await client.query("commit");
    // 落库成功后写盘；失败则回删行（个人系统：极小概率，保证不留死链）
    try {
      for (const p of prepared) await saveImageFile(p.key, p.data);
    } catch (e) {
      await pool.query(`delete from entry_images where entry_id = $1 and storage_key = any($2)`, [
        entryId,
        prepared.map((p) => p.key),
      ]).catch(() => {});
      throw e;
    }
    return { ok: true as const, images: inserted };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("[images] 上传失败:", e);
    throw new ApiError(500, "upstream", "上传失败，请重试");
  } finally {
    client.release();
  }
}

/** DELETE /api/entries/:id/images/:imageId —— 删除单张图片（删行 + 异步删盘上文件） */
export async function deleteEntryImage(userId: string, entryId: string, imageId: string) {
  const { rows } = await pool.query(
    `delete from entry_images where id = $1 and entry_id = $2 and user_id = $3 returning storage_key`,
    [imageId, entryId, userId],
  );
  if (!rows[0]) throw ApiError.notFound("图片不存在");
  void deleteImageFile(rows[0].storage_key);
  return { ok: true as const };
}

/** DELETE /api/entries/:id/diet —— 删除该动态的饮食记录（识别产物可单独删除） */
export async function deleteEntryDiet(userId: string, entryId: string) {
  const { rowCount } = await pool.query(
    `delete from diet_records where entry_id = $1 and user_id = $2`,
    [entryId, userId],
  );
  // 识别登记簿同步置"已删除"，避免统计/重识别状态与实际不符
  await pool.query(
    `update entry_recognitions set status = 'none', result = result || '{"reason": "用户已删除饮食记录"}'::jsonb
     where entry_id = $1 and user_id = $2 and domain = 'diet'`,
    [entryId, userId],
  );
  if (!rowCount) throw ApiError.notFound("没有饮食记录");
  return { ok: true as const };
}

/** POST /api/feed/:id/dismiss-conflict —— 关闭日程冲突警示条（服务端标记 reasonDismissed，多端持久） */
export async function dismissScheduleConflict(userId: string, entryId: string) {
  const { rowCount } = await pool.query(
    `update entry_recognitions
     set result = coalesce(result, '{}'::jsonb) || '{"reasonDismissed": true}'::jsonb
     where entry_id = $1 and user_id = $2 and domain = 'schedule'`,
    [entryId, userId],
  );
  if (!rowCount) throw ApiError.notFound("无冲突提示可关闭");
  return { ok: true as const };
}

/** DELETE /api/feed/:id：删除动态及全部识别产物（子表显式清理，盘上图片异步清） */
export async function deleteFeed(userId: string, entryId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const imageKeys = await entriesRepo.imageKeysOf(client, entryId, userId);
    if (imageKeys.length) {
      await client.query(`delete from entry_images where entry_id = $1 and user_id = $2`, [entryId, userId]);
    }
    await entriesRepo.clearDerived(client, entryId, userId);
    const { rowCount } = await entriesRepo.deleteEntry(client, entryId, userId);
    if (!rowCount) {
      await client.query("rollback");
      throw ApiError.notFound("动态不存在");
    }
    await client.query("commit");
    for (const k of imageKeys) void deleteImageFile(k);
    return { ok: true as const };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e instanceof ApiError) throw e;
    throw ApiError.upstream("删除失败", String(e).slice(0, 200));
  } finally {
    client.release();
  }
}
