/**
 * timeline 域 service（REQ-004 FR-B1 / 4-C）：动态采集、五域识别编排、确认流。
 * timeline 是核心域：parse 编排持有识别产物落库的唯一入口（analyzeAndPersist），
 * confirm/edit 时清理并重写各域子表（四域域表写入的既有语义逐行保留）。
 */
import { pool } from "@/lib/db";
import { ruleMood } from "@shiguangri/ai";
import { checkAiQuota } from "@/lib/quota";
import { deleteImageFile } from "@/lib/storage";
import { ApiError } from "../platform/http/errors";
import { analyzeAndPersist } from "./analyze";
import { entriesRepo } from "./repo";

type Domain = "schedule" | "todo" | "finance" | "mood" | "diet";

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
  void analyzeAndPersist(userId, entry.id, text.trim())
    .catch((e) => console.error("[analyze] 后台识别失败:", e))
    .finally(() => entriesRepo.setAnalyzedAt(entry.id).catch(() => {}));
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
    const entry = await entriesRepo.rawTextOf(entryId, userId);
    if (!entry) {
      await client.query("rollback");
      throw ApiError.notFound("动态不存在");
    }

    switch (domain) {
      case "mood": {
        if (result.label) {
          await pool.query(`update entries set mood = $1, mood_score = $2 where id = $3`, [
            result.label, result.score ?? 0, entryId,
          ]);
        }
        break;
      }
      case "schedule": {
        if (result.startAt && result.endAt && result.activityId && result.title) {
          await pool.query(`delete from time_blocks where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await pool.query(
            `insert into time_blocks (user_id, entry_id, activity_id, title, start_at, end_at, time_mode, source)
             values ($1,$2,$3,$4,$5,$6,'default','keyboard')`,
            [userId, entryId, result.activityId, result.title, result.startAt, result.endAt],
          );
        }
        break;
      }
      case "todo": {
        if (result.dueAt && result.title) {
          await pool.query(`delete from todos where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await pool.query(
            `insert into todos (user_id, entry_id, title, due_at, remind_at, source, space_id)
             values ($1,$2,$3,$4,$5,'keyboard',(select space_id from entries where id = $2))`,
            [userId, entryId, result.title, result.dueAt, new Date(new Date(result.dueAt).getTime() - 15 * 60_000).toISOString()],
          );
        }
        break;
      }
      case "finance": {
        if (result.amountCents != null) {
          await pool.query(`delete from transactions where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await pool.query(
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
          await pool.query(`delete from diet_records where entry_id = $1 and user_id = $2`, [entryId, userId]);
          await pool.query(
            `insert into diet_records (user_id, entry_id, meal, items, total_kcal)
             values ($1,$2,$3,$4,$5)`,
            [userId, entryId, result.meal ?? "未知", JSON.stringify(result.items), result.totalKcal ?? null],
          );
        }
        break;
      }
    }

    await entriesRepo.applyRecognition(rec.id);
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
  const spaceParamIndex = 4;
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
    // 后台全域重识别（同发动态：秒回 + fire-and-forget），成败都打 analyzed_at
    void analyzeAndPersist(userId, entryId, text)
      .catch((e) => console.error(`[analyze] entry ${entryId} 编辑重识别失败:`, e))
      .finally(() => entriesRepo.setAnalyzedAt(entryId).catch(() => {}));
    return { ok: true as const, entry: updated };
  }

  const label = body.mood?.trim() || null;
  const score = label ? (ruleMood(label)?.score ?? 0) : null;
  const updated = (await entriesRepo.setMoodByEntry(entryId, userId, label, score)).rows[0];
  if (!updated) throw ApiError.notFound("动态不存在");
  return { entry: updated };
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
