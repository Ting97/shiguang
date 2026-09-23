/**
 * 复盘输入装配（REQ-003 3-A）：review 四档（day/week/month/year）的共享构建路径。
 * 路由与 /admin 装配预览都走 buildReviewCtx——保证「预览即所见即所得」。
 * - 注入开关（bundle.config.inject）关闭的块不取数、不进 ctx
 * - 明细行上限（bundle.config.caps）下沉 SQL LIMIT（cap=0 不设限），并配 count(*) 保留
 *   「（另有 N 条…未展示）」截断注记的真实条数语义
 * - year 动态明细维持心情强度优先抽样（entryCap = 抽样条数，0 = 全量不抽样）
 */
import { pool } from "@/server/platform/db";
import {
  blockLines, entryLines, fetchChainSummaries, loadProfileBlock, sampleEntryRows, todoDoneLines,
} from "./review-input";
import { assembleUserPrompt, type PromptBundle, type PromptKey } from "@/server/ai/prompts";

const TZ = "Asia/Shanghai";

export type ReviewContentKind = "day" | "week" | "month" | "year";
export interface ReviewPeriod { date?: string; month?: string; year?: string }

const pad2 = (n: number) => String(n).padStart(2, "0");
const localYmd = (x: Date) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ""}` : `${m}分`);

/** 行上限截断（含真实总数的截断注记；cap=0 全量保留。修正原 withCap 的「条条/条个」叠字） */
function capLines(lines: string[], cap: number, label: string, total: number): string[] {
  const effective = cap > 0 ? Math.min(cap, lines.length) : lines.length;
  const out = lines.slice(0, effective);
  if (total > effective) out.push(`（另有 ${total - effective} ${label}未展示）`);
  return out;
}

export interface ReviewBuild {
  from: string;
  to: string;
  /** 装配 ctx（已按开关/上限裁剪） */
  ctx: Record<string, string>;
  /** 装配好的最终 user prompt（与线上一致） */
  userPrompt: string;
  /** 数据最近变动时刻（缓存失效门禁用） */
  latest: Date | null;
  /** 路由响应附带的聚合摘要 */
  summary: { timeParts: string[]; todoDone: number };
}

/** 四档复盘共享构建：聚合事实 + 注入/上限裁剪后的明细块 + 小结链 + 画像 → 最终 user prompt */
export async function buildReviewCtx(
  userId: string,
  kind: ReviewContentKind,
  period: ReviewPeriod,
  bundle: PromptBundle,
): Promise<ReviewBuild> {
  const cfg = bundle.config;
  const key = `review_${kind}` as PromptKey;

  // ---- 期间换算（周一为一周开始；月为自然月；年为自然年）----
  let from: string;
  let to: string;
  let periodLabel: string;
  if (kind === "day") {
    const date = period.date ?? localYmd(new Date());
    from = to = date;
    periodLabel = `日期：${date}`;
  } else if (kind === "week") {
    const d = new Date((period.date ?? localYmd(new Date())) + "T00:00:00");
    const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000);
    from = localYmd(monday);
    to = localYmd(new Date(monday.getTime() + 6 * 86_400_000));
    periodLabel = `周期：${from} 至 ${to}`;
  } else if (kind === "month") {
    const month = period.month ?? localYmd(new Date()).slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    from = `${month}-01`;
    to = localYmd(new Date(y, m, 0));
    periodLabel = `周期：${month}月（${from} 至 ${to}）`;
  } else {
    const year = period.year ?? String(new Date().getFullYear());
    from = `${year}-01-01`;
    to = `${year}-12-31`;
    periodLabel = `周期：${year} 年（${from} 至 ${to}）`;
  }

  const baseParams = [userId, TZ, from, to];
  const entryCap = cfg.caps.entryCap ?? 0;
  const blockCap = cfg.caps.blockCap ?? 0;
  const todoCap = cfg.caps.todoCap ?? 0;

  // ---- 聚合 + 明细并行取数（注入关闭的明细不取数；cap>0 下沉 SQL LIMIT）----
  const [timeRows, todoRows, txRows, interactRows, kcalRows, entryRows, subRows, rawEntryRows, blockRows, todoListRows, entryCountRows, blockCountRows, todoCountRows] =
    await Promise.all([
      pool.query(
        `select a.name, a.icon,
                sum(floor(extract(epoch from least((b.end_at at time zone $2), ($4::date + 1))
                         - greatest((b.start_at at time zone $2), $3::date)) / 60))::int as mins
         from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
         where b.user_id = $1
           and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
         group by 1, 2 order by mins desc limit 5`,
        baseParams,
      ),
      pool.query(
        `select count(*)::int as n from todos
         where user_id = $1 and status = 'done'
           and (done_at at time zone $2)::date between $3::date and $4::date`,
        baseParams,
      ),
      pool.query(
        `select coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents,
                coalesce(sum(case when direction='in' then amount_cents else 0 end),0)::int as in_cents
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date`,
        baseParams,
      ),
      pool.query(
        `select c.name, count(*)::int as n from interactions i join contacts c on c.id = i.contact_id
         where i.user_id = $1 and (i.occurred_at at time zone $2)::date between $3::date and $4::date
         group by 1 order by n desc limit ${kind === "day" ? 5 : 3}`,
        baseParams,
      ),
      // day 独有：饮食总热量事实行
      kind === "day"
        ? pool.query(
            `select coalesce(sum(d.total_kcal), 0)::int as kcal
             from diet_records d join entries e on e.id = d.entry_id
             where d.user_id = $1 and (e.created_at at time zone $2)::date between $3::date and $4::date`,
            baseParams,
          )
        : Promise.resolve({ rows: [{ kcal: 0 }] }),
      pool.query(
        `select count(*)::int as n,
                count(distinct (created_at at time zone $2)::date)::int as days,
                coalesce(array_agg(distinct mood) filter (where mood is not null), '{}') as moods
         from entries
         where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date`,
        baseParams,
      ),
      buildSubRows(userId, kind, from, to),
      // 原始明细：year 全量取回（抽样与总数需要）；其余按 cap LIMIT；注入关闭则不查
      cfg.inject.entryDetail
        ? pool.query(
            `select raw_text, mood, mood_score, created_at from entries
             where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
             order by created_at${kind !== "year" && entryCap > 0 ? ` limit ${entryCap}` : ""}`,
            baseParams,
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      cfg.inject.blockDetail
        ? pool.query(
            `select b.title, b.start_at, b.end_at, a.icon, a.name
             from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
             where b.user_id = $1
               and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
             order by b.start_at${blockCap > 0 ? ` limit ${blockCap}` : ""}`,
            baseParams,
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      cfg.inject.todoDetail
        ? pool.query(
            `select title, done_at from todos
             where user_id = $1 and status = 'done' and (done_at at time zone $2)::date between $3::date and $4::date
             order by done_at${todoCap > 0 ? ` limit ${todoCap}` : ""}`,
            baseParams,
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      // 截断注记所需真实总数（仅 cap>0 且注入开启才查；year 由明细行数直接得）
      cfg.inject.entryDetail && kind !== "year" && entryCap > 0
        ? pool.query(
            `select count(*)::int as n from entries where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date`,
            baseParams,
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
      cfg.inject.blockDetail && blockCap > 0
        ? pool.query(
            `select count(*)::int as n from time_blocks b
             where b.user_id = $1
               and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)`,
            baseParams,
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
      cfg.inject.todoDetail && todoCap > 0
        ? pool.query(
            `select count(*)::int as n from todos
             where user_id = $1 and status = 'done' and (done_at at time zone $2)::date between $3::date and $4::date`,
            baseParams,
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
    ]);

  const timeParts = (timeRows.rows as { icon: string; name: string; mins: number }[]).map(
    (r) => `${r.icon}${r.name} ${fmtMin(r.mins)}`,
  );
  const todoDone = (todoRows.rows[0] as { n: number }).n;

  // ---- facts（聚合 + 子周期对比行）----
  const facts = [
    periodLabel,
    `时间投入：${timeParts.length ? timeParts.join("、") : "无"}`,
    `完成 todo：${todoDone} 件`,
    `支出 ¥${((txRows.rows[0] as { out_cents: number }).out_cents / 100).toFixed(0)} · 收入 ¥${((txRows.rows[0] as { in_cents: number }).in_cents / 100).toFixed(0)}`,
    interactRows.rows.length
      ? `人际互动：${(interactRows.rows as { name: string; n: number }[]).map((r) => `${r.name}${r.n}次`).join("、")}`
      : "人际互动：无",
    `动态 ${(entryRows.rows[0] as { n: number }).n} 条（覆盖 ${(entryRows.rows[0] as { days: number }).days} 天）${(entryRows.rows[0] as { moods: string[] }).moods.length ? `（心情：${(entryRows.rows[0] as { moods: string[] }).moods.join("、")}）` : ""}`,
    ...(kind === "day" && (kcalRows.rows[0] as { kcal: number }).kcal > 0 ? [`饮食约 ${(kcalRows.rows[0] as { kcal: number }).kcal} kcal`] : []),
    ...buildSubLines(kind, period, subRows, from, to),
  ];

  // ---- 明细块（按注入开关与上限裁剪）----
  const entryDetail = cfg.inject.entryDetail
    ? buildEntryBlock(kind, rawEntryRows.rows as EntryRowT[], entryCap, (entryCountRows.rows[0] as { n: number }).n)
    : "";
  const blockDetail = cfg.inject.blockDetail
    ? ["日程块：", ...capLines(blockLines(blockRows.rows as BlockRowT[]), blockCap, "个日程", (blockCountRows.rows[0] as { n: number }).n)].join("\n")
    : "";
  const todoDetail = cfg.inject.todoDetail
    ? ["完成 todo：", ...capLines(todoDoneLines(todoListRows.rows as TodoRowT[]), todoCap, "条 todo", (todoCountRows.rows[0] as { n: number }).n)].join("\n")
    : "";

  // ---- 小结链 + 画像（注入关闭不取数）----
  const chainBlock = cfg.inject.chainBlock ? await buildChain(userId, kind, period) : "";
  const profileCtx = cfg.inject.profileBlock ? await buildProfileCtxValue(userId) : "";

  const ctx: Record<string, string> = {
    facts: facts.join("\n"),
    chainBlock,
    entryDetail,
    blockDetail,
    todoDetail,
    profileBlock: profileCtx,
  };
  const userPrompt = await assembleUserPrompt(key, bundle, ctx, { userId });

  return {
    from,
    to,
    ctx,
    userPrompt,
    latest: await buildLatest(userId, kind, period),
    summary: { timeParts, todoDone },
  };
}

type EntryRowT = { created_at: string | Date; raw_text: string; mood?: string | null; mood_score?: number | null };
type BlockRowT = { start_at: string | Date; end_at: string | Date; title: string; icon: string; name: string };
type TodoRowT = { done_at: string | Date | null; title: string };

/** year 动态块：心情强度优先抽样（entryCap=条数，0=全量）；其余档：直接逐条（cap 已在 SQL 层生效，total 为真实总数用于截断注记） */
function buildEntryBlock(kind: ReviewContentKind, rows: EntryRowT[], entryCap: number, entryTotal = rows.length): string {
  if (kind === "year") {
    const sampled = entryCap > 0 ? sampleEntryRows(rows, entryCap) : rows;
    const total = rows.length;
    const used = sampled.length;
    return [
      "代表性原始动态（时间 原文 心情）：",
      [...entryLines(sampled), ...(total > used ? [`（全年共 ${total} 条动态，以上为代表性抽样 ${used} 条）`] : [])].join("\n"),
    ].join("\n");
  }
  return ["原始动态（时间 原文 心情）：", ...capLines(entryLines(rows), entryCap, "条动态", Math.max(rows.length, entryTotal))].join("\n");
}

/** 小结链块：周←7日 / 月←各周 / 年←12月，只取已有缓存（与原 fetchChainSummaries 调用一致） */
async function buildChain(userId: string, kind: ReviewContentKind, period: ReviewPeriod): Promise<string> {
  if (kind === "day") return "";
  if (kind === "week") {
    const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const d = new Date((period.date ?? localYmd(new Date())) + "T00:00:00");
    const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000);
    const lines = await fetchChainSummaries(
      userId,
      "week",
      Array.from({ length: 7 }, (_, i) => {
        const day = new Date(monday.getTime() + i * 86_400_000);
        return { key: localYmd(day), label: `${WD[i]}(${Number(localYmd(day).slice(5, 7))}/${Number(localYmd(day).slice(8, 10))})` };
      }),
    );
    return lines.length ? "本周各日小结：\n" + lines.join("\n") : "";
  }
  if (kind === "month") {
    const month = period.month ?? localYmd(new Date()).slice(0, 7);
    const [yy, mm] = month.split("-").map(Number);
    const firstDow = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
    const weekKeys: string[] = [];
    for (let t = new Date(yy, mm - 1, 1).getTime() - firstDow * 86_400_000; t <= new Date(yy, mm, 0).getTime(); t += 7 * 86_400_000) {
      weekKeys.push(localYmd(new Date(t)));
    }
    const lines = await fetchChainSummaries(
      userId,
      "month",
      weekKeys.map((k) => ({ key: k, label: `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}周` })),
    );
    return lines.length ? "本月各周小结：\n" + lines.join("\n") : "";
  }
  const year = period.year ?? String(new Date().getFullYear());
  const lines = await fetchChainSummaries(
    userId,
    "year",
    Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${pad2(i + 1)}`, label: `${i + 1}月` })),
  );
  return lines.length ? "全年各月月报小结：\n" + lines.join("\n") : "";
}

async function buildProfileCtxValue(userId: string): Promise<string> {
  const profile = await loadProfileBlock(userId);
  return profile ? `该用户的已知画像（供理解参考，不要复述）：\n${profile}` : "";
}

/** 数据最近变动时刻（day/week/month 用 from–to 区间；year 按自然年字段匹配，与原实现一致） */
async function buildLatest(userId: string, kind: ReviewContentKind, period: ReviewPeriod): Promise<Date | null> {
  if (kind !== "day" && kind !== "week" && kind !== "month") {
    const year = Number(period.year ?? new Date().getFullYear());
    const { rows } = await pool.query(
      `select greatest(
         (select max(created_at) from entries where user_id = $1 and extract(year from created_at) = $2::int),
         (select max(done_at) from todos where user_id = $1 and status = 'done' and extract(year from done_at) = $2::int),
         (select max(occurred_at) from transactions where user_id = $1 and extract(year from occurred_at) = $2::int),
         (select max(start_at) from time_blocks where user_id = $1 and extract(year from start_at) = $2::int and start_at <= now()),
         (select max(occurred_at) from interactions where user_id = $1 and extract(year from occurred_at) = $2::int)
       ) as latest`,
      [userId, year],
    );
    return (rows[0]?.latest as Date | null) ?? null;
  }
  let from: string;
  let to: string;
  if (kind === "day") {
    from = to = period.date ?? localYmd(new Date());
  } else if (kind === "week") {
    const d = new Date((period.date ?? localYmd(new Date())) + "T00:00:00");
    const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000);
    from = localYmd(monday);
    to = localYmd(new Date(monday.getTime() + 6 * 86_400_000));
  } else {
    const month = period.month ?? localYmd(new Date()).slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    from = `${month}-01`;
    to = localYmd(new Date(y, m, 0));
  }
  const { rows } = await pool.query(
    `select greatest(
       (select max(created_at) from entries where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date),
       (select max(done_at) from todos where user_id = $1 and status = 'done' and (done_at at time zone $2)::date between $3::date and $4::date),
       (select max(occurred_at) from transactions where user_id = $1 and (occurred_at at time zone $2)::date between $3::date and $4::date),
       (select max(start_at) from time_blocks where user_id = $1 and (start_at at time zone $2)::date between $3::date and $4::date and start_at <= now()),
       (select max(occurred_at) from interactions where user_id = $1 and (occurred_at at time zone $2)::date between $3::date and $4::date)
     ) as latest`,
    [userId, TZ, from, to],
  );
  return (rows[0]?.latest as Date | null) ?? null;
}

interface SubAgg { acts: string[]; n: number; out: number }

/** 子周期对比行：day 无；week 每日 top2 / month 每周 top3 / year 每月 top3（口径与各路由原实现一致） */
function buildSubLines(
  kind: ReviewContentKind,
  period: ReviewPeriod,
  sub: { rows: Record<string, unknown>[] },
  from: string,
  _to: string,
): string[] {
  if (kind === "day") return [];
  const timeRows = { rows: sub.rows.filter((r) => "mins" in r) };
  const entryRows = { rows: sub.rows.filter((r) => "n" in r) };
  const txRows = { rows: sub.rows.filter((r) => "out_cents" in r) };
  const bitsOf = (d: SubAgg) => [d.acts.join("、"), d.n ? `动态${d.n}条` : "", d.out ? `支出¥${(d.out / 100).toFixed(0)}` : ""].filter(Boolean);
  const fmtBits = (label: string, d: SubAgg) => `${label}：${bitsOf(d).length ? bitsOf(d).join(" · ") : "无记录"}`;
  const acc = () => ({ acts: [] as string[], n: 0, out: 0 });

  if (kind === "week") {
    const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const d0 = new Date(from + "T00:00:00");
    const agg = new Map<string, SubAgg>(
      Array.from({ length: 7 }, (_, i) => [localYmd(new Date(d0.getTime() + i * 86_400_000)), acc()]),
    );
    for (const r of timeRows.rows as { day: string; icon: string; name: string; mins: number }[]) {
      const d = agg.get(r.day);
      if (d && d.acts.length < 2) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
    }
    for (const r of entryRows.rows as { day: string; n: number }[]) {
      const d = agg.get(r.day);
      if (d) d.n = r.n;
    }
    for (const r of txRows.rows as { day: string; out_cents: number }[]) {
      const d = agg.get(r.day);
      if (d) d.out = r.out_cents;
    }
    return [
      "每日明细：",
      ...[...agg.entries()].map(([k, d], i) => fmtBits(`${WD[i]}(${k.slice(5)})`, d)),
    ];
  }

  if (kind === "month") {
    const month = period.month ?? from.slice(0, 7);
    const [yy, mm] = month.split("-").map(Number);
    const wkKey = (k: unknown) => (typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
    const agg = new Map<string, SubAgg>();
    const touch = (k: string) => {
      const d = agg.get(k) ?? acc();
      agg.set(k, d);
      return d;
    };
    for (const r of timeRows.rows as { wk: string; icon: string; name: string; mins: number }[]) {
      const k = wkKey(r.wk);
      if (!k) continue;
      const d = touch(k);
      if (d.acts.length < 3) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
    }
    for (const r of entryRows.rows as { wk: string; n: number }[]) {
      const k = wkKey(r.wk);
      if (!k) continue;
      touch(k).n = r.n;
    }
    for (const r of txRows.rows as { wk: string; out_cents: number }[]) {
      const k = wkKey(r.wk);
      if (!k) continue;
      touch(k).out = r.out_cents;
    }
    const firstDow = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
    const lines: string[] = ["每周对比："];
    for (let t = new Date(yy, mm - 1, 1).getTime() - firstDow * 86_400_000; t <= new Date(yy, mm, 0).getTime(); t += 7 * 86_400_000) {
      const k = localYmd(new Date(t));
      lines.push(fmtBits(`${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}周`, agg.get(k) ?? acc()));
    }
    return lines;
  }

  // year：逐月轨迹
  const agg = new Map<number, SubAgg>(Array.from({ length: 12 }, (_, i) => [i + 1, acc()]));
  for (const r of timeRows.rows as { mm: number; icon: string; name: string; mins: number }[]) {
    const d = agg.get(r.mm);
    if (d && d.acts.length < 3) d.acts.push(`${r.icon}${r.name} ${fmtMin(r.mins)}`);
  }
  for (const r of entryRows.rows as { mm: number; n: number }[]) {
    const d = agg.get(r.mm);
    if (d) d.n = r.n;
  }
  for (const r of txRows.rows as { mm: number; out_cents: number }[]) {
    const d = agg.get(r.mm);
    if (d) d.out = r.out_cents;
  }
  return [
    "逐月轨迹：",
    ...[...agg.entries()].map(([mm, d]) => fmtBits(`${mm}月`, d)),
  ];
}

/** 子周期聚合三查询（day 无；week 按日 / month 按自然周 / year 按月；跨期块分摊口径与原实现一致） */
async function buildSubRows(
  userId: string,
  kind: ReviewContentKind,
  from: string,
  to: string,
): Promise<{ rows: Record<string, unknown>[] }> {
  if (kind === "day") return { rows: [] };
  const base = [userId, TZ, from, to];
  if (kind === "week") {
    const [a, b, c] = await Promise.all([
      pool.query(
        `select (b.start_at at time zone $2)::date::text as day, a.name, a.icon,
                sum(floor(extract(epoch from least((b.end_at at time zone $2), ($4::date + 1))
                         - greatest((b.start_at at time zone $2), $3::date)) / 60))::int as mins
         from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
         where b.user_id = $1
           and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
         group by 1, 2, 3`,
        base,
      ),
      pool.query(
        `select (created_at at time zone $2)::date::text as day, count(*)::int as n
         from entries
         where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
         group by 1`,
        base,
      ),
      pool.query(
        `select (occurred_at at time zone $2)::date::text as day,
                coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date
         group by 1`,
        base,
      ),
    ]);
    return { rows: [...a.rows, ...b.rows, ...c.rows] };
  }
  // month：date_trunc('week')，跨月周只计入本月内的时长；year：extract(month)，跨月块按起止月分摊
  const keyExpr = (col: string) =>
    kind === "month"
      ? `to_char(date_trunc('week', (${col} at time zone $2)), 'YYYY-MM-DD') as wk`
      : `extract(month from (${col} at time zone $2))::int as mm`;
  const [a, b, c] = await Promise.all([
    pool.query(
      `select ${keyExpr("b.start_at")}, a.name, a.icon,
              sum(floor(extract(epoch from
                least(least((b.end_at at time zone $2), ($4::date + 1)), date_trunc('${kind === "month" ? "week" : "month"}', (b.start_at at time zone $2)) + interval '${kind === "month" ? "7 days" : "1 month"}')
                - greatest(greatest((b.start_at at time zone $2), $3::date), date_trunc('${kind === "month" ? "week" : "month"}', (b.start_at at time zone $2)))
              ) / 60))::int as mins
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1
         and (b.end_at at time zone $2) > $3::date and (b.start_at at time zone $2) < ($4::date + 1)
       group by 1, 2, 3`,
      base,
    ),
    pool.query(
      `select ${keyExpr("created_at")}, count(*)::int as n
       from entries
       where user_id = $1 and (created_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      base,
    ),
    pool.query(
      `select ${keyExpr("occurred_at")},
              coalesce(sum(case when direction='out' then amount_cents else 0 end),0)::int as out_cents
       from transactions
       where user_id = $1 and is_draft = false
         and (occurred_at at time zone $2)::date between $3::date and $4::date
       group by 1`,
      base,
    ),
  ]);
  return { rows: [...a.rows, ...b.rows, ...c.rows] };
}
