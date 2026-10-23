/**
 * 训记（SynFit）Open API 客户端与拾光↔训记映射（REQ-017）。
 * 接口契约与官方 Skill 硬规则以 life/fitness/xunji-api.md 实测笔记为准：
 * - 只在用户确认后写（拾光确认卡/同步按钮即确认；本模块无任何静默写入路径）
 * - 按日读缓存 90s；too frequent 按 retry 秒数提示；成功判定 HTTP 200 + 有 res
 * - 上限：单次 ≤4 条训练（同日）、每条 ≤15 动作、每动作 ≤20 组
 * - 更新必须保留 localid/start/end；不带 localid 为新建；无删除接口
 * - dry_run 会真实落库（实测踩坑）——一律直接写
 * - key 只存 .env（XUNJI_API_KEY，经 config），不落日志不回显
 */
import { createHash } from "node:crypto";
import { loadConfig } from "@/server/platform/config";
import { ApiError } from "@/server/platform/http/errors";
import type { RunPlanContent, StrengthPlanContent } from "@shiguangri/shared/fitness-types";

export const XUNJI_BASE = "https://trains.xunjiapp.cn";
const READ_CACHE_TTL_MS = 90_000;
const TIMEOUT_MS = 15_000;

/** 测试注入用（仿 bitget-client FetchLike） */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

// ---------------------------------------------------------------------------
// 官方动作名映射（拾光种子名 → 训记官方中文名；已实测/笔记确认的才收录，
// 其余同名——写入前统一过 catalog 校验，未匹配拒绝并列名让用户改）
// ---------------------------------------------------------------------------

export const XUNJI_NAME_ALIAS: Record<string, string> = {
  高脚杯深蹲: "哑铃酒杯深蹲",
  哑铃肩推: "哑铃推肩",
};

/** 计时型动作（训记 exetype=record，组用 time 秒而非 reps 次数） */
const TIME_LIKE = new Set(["平板支撑"]);

export interface XunjiSet {
  done: boolean;
  weight?: string;
  unit?: string;
  reps?: string;
  time?: string;
  rpe?: string;
}

export interface XunjiMovement {
  name: string;
  restTime?: number;
  difficulty?: "easy" | "normal" | "hard";
  sets?: XunjiSet[];
  /** 计时型动作 */
  exetype?: "record";
  /** 有氧日（跑步等）：不传 sets，指标放 metrics */
  cardio?: boolean;
  recordPreset?: string;
  metrics?: Record<string, string | number>;
}

export interface XunjiTrain {
  localid?: string | number;
  /** 训练所属北京日（必填——实测缺它 upsert 报 datestr invalid） */
  datestr?: string;
  /** epoch 毫秒（读回形态；新建可省略，更新必须原样保留） */
  start?: number;
  end?: number;
  title?: string;
  movements: XunjiMovement[];
}

// ---------------------------------------------------------------------------
// 纯映射函数（单测主战场）
// ---------------------------------------------------------------------------

/** repsText → 次数目标（取上限，双递进语义："8-12"→12；"10/侧"→10；解析不出 null） */
export function parseRepsTarget(repsText?: string | null): number | null {
  if (!repsText) return null;
  const nums = [...repsText.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n <= 100);
  return nums.length ? Math.max(...nums) : null;
}

/** repsText → 秒数（计时动作："30-45s"→45；无秒标记 null） */
export function parseSecondsTarget(repsText?: string | null): number | null {
  if (!repsText || !/s|秒/i.test(repsText)) return null;
  const nums = [...repsText.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n <= 600);
  return nums.length ? Math.max(...nums) : null;
}

const kgStr = (weightG?: number | null) =>
  weightG != null && weightG > 0 ? (Math.round(weightG / 100) / 10).toString() : undefined;

/** 动作条目 → 训记 movement（计划组 done:false；至少含 weight/reps/time 之一否则报错） */
export function exerciseToMovement(
  e: { name: string; sets?: number | null; repsText?: string | null; weightG?: number | null; rir?: number | null },
  officialName: string,
): XunjiMovement {
  if (e.sets != null && (e.sets < 1 || e.sets > 20)) throw ApiError.badRequest(`动作「${e.name}」组数须在 1~20`);
  const setCount = e.sets ?? 3;
  const isTime = TIME_LIKE.has(e.name);
  const weight = kgStr(e.weightG);
  const reps = isTime ? null : parseRepsTarget(e.repsText);
  const time = isTime ? parseSecondsTarget(e.repsText) ?? parseRepsTarget(e.repsText) : null;
  if (weight == null && reps == null && time == null) {
    throw ApiError.badRequest(`动作「${e.name}」缺目标（重量/次数/秒数至少一项），无法写入训记`);
  }
  const base: XunjiSet = { done: false };
  if (weight != null) {
    base.weight = weight;
    base.unit = "kg";
  }
  if (reps != null) base.reps = String(reps);
  if (time != null) base.time = String(time);
  const mv: XunjiMovement = { name: officialName, restTime: 90, difficulty: "normal", sets: Array.from({ length: setCount }, () => ({ ...base })) };
  if (isTime) mv.exetype = "record";
  return mv;
}

/** 拾光计划 → 训记 train（单条；跑步=有氧日 cardio）。名称官方化在调用侧完成：
 * officialName 返回 null 表示用户确认跳过的动作——该动作不写入训记（REQ-023）；
 * runOfficialName 为跑步有氧日写入名（v1.1：默认对齐目录内官方条目，见 resolveRunOfficialName） */
export function planToTrain(
  plan: { module_code: string; plan_date: string; content: RunPlanContent | StrengthPlanContent },
  officialName: (name: string) => string | null,
  runOfficialName = "跑步",
): XunjiTrain {
  if (plan.module_code === "strength") {
    const c = plan.content as StrengthPlanContent;
    if (c.exercises.length > 15) throw ApiError.badRequest("训记单条训练最多 15 个动作");
    const movements: XunjiMovement[] = [];
    for (const e of c.exercises) {
      const official = officialName(e.name);
      if (official == null) continue;
      movements.push(exerciseToMovement(e, official));
    }
    return { datestr: plan.plan_date, title: c.title, movements };
  }
  const c = plan.content as RunPlanContent;
  const metrics: Record<string, string | number> = {};
  if (c.totalDistanceM) metrics.distance = `${(c.totalDistanceM / 1000).toFixed(1)}km`;
  if (c.durationMin) metrics.duration = `${c.durationMin}min`;
  if (c.segments.length) metrics.segments = c.segments.map((s) => s.label).join("/");
  return {
    datestr: plan.plan_date,
    title: c.title,
    movements: [
      {
        name: runOfficialName,
        cardio: true,
        recordPreset: "running",
        metrics,
      },
    ],
  };
}

/** 读回：训记当日 trains → 拾光 actual 力量明细（只取 done 组；名称反查回拾光名） */
export function trainsToStrengthActual(
  trains: XunjiTrain[],
  localNames: (official: string) => string,
): { exercises: { name: string; sets: number; repsText: string; weightG: number | null }[]; doneSets: number; totalSets: number } {
  const out: { name: string; sets: number; repsText: string; weightG: number | null }[] = [];
  let doneSets = 0;
  let totalSets = 0;
  for (const t of trains) {
    for (const mv of t.movements ?? []) {
      if (mv.cardio) continue;
      const sets = (mv.sets ?? []).filter((s) => s.done);
      totalSets += (mv.sets ?? []).length;
      if (!sets.length) continue;
      doneSets += sets.length;
      const weightG = sets.every((s) => s.weight == null)
        ? null
        : Math.round(Number(sets.filter((s) => s.weight != null).pop()?.weight ?? 0) * 1000);
      const repsList = sets.map((s) => (s.time ? `${s.time}s` : s.reps ?? "")).filter(Boolean);
      out.push({
        name: localNames(mv.name),
        sets: sets.length,
        repsText: repsList.length ? [...new Set(repsList)].join("/") : "",
        weightG,
      });
    }
  }
  return { exercises: out, doneSets, totalSets };
}

/** 读回：训记有氧日 → 跑步 actual（距离/时长尽力从 metrics 提取） */
export function trainsToRunActual(trains: XunjiTrain[]): { distanceM?: number; durationS?: number; note?: string } {
  const actual: { distanceM?: number; durationS?: number; note?: string } = {};
  for (const t of trains) {
    for (const mv of t.movements ?? []) {
      if (!mv.cardio) continue;
      const m = mv.metrics ?? {};
      const km = Number(String(m.distance ?? "").replace(/[^\d.]/g, ""));
      if (km > 0) actual.distanceM = Math.round(km * 1000);
      const min = Number(String(m.duration ?? "").replace(/[^\d.]/g, ""));
      if (min > 0) actual.durationS = Math.round(min * 60);
      if (m.segments) actual.note = `训记有氧：${m.segments}`;
    }
  }
  return actual;
}

// ---------------------------------------------------------------------------
// HTTP 客户端（读缓存 / 错误分类）
// ---------------------------------------------------------------------------

interface XunjiShell {
  res?: unknown;
  error?: string;
  msg?: string;
  message?: string;
  retry?: number;
}

function requireKey(): string {
  const key = loadConfig().xunjiApiKey;
  if (!key) throw new ApiError(503, "upstream", "未配置 XUNJI_API_KEY——请在 .env 填入训记 App 内申请的 key 后重启");
  return key;
}

/** key 无效文案统一指向每用户配置入口（REQ-042 起 key 按用户绑定） */
function toApiError(payload: XunjiShell, status: number): ApiError {
  // 实测错误形态：{"success":false,"res":"too frequent, retry after 20s"}（文案在 res 字符串里）
  const raw = typeof payload.res === "string" && payload.res ? payload.res : String(payload.error ?? payload.msg ?? payload.message ?? `HTTP ${status}`);
  if (/apikey missing|apikey invalid/i.test(raw)) {
    return new ApiError(502, "upstream", `训记 apiKey 无效（${raw}）——请在【我的 → 训记同步】重新绑定训记 App 内申请的 key`);
  }
  if (/仅VIP|vip/i.test(raw)) {
    return new ApiError(402, "upstream", "训记提示「仅 VIP 可用」——写入功能需要训记 App 会员");
  }
  if (/too frequent/i.test(raw)) {
    const m = /retry after (\d+)s?/i.exec(raw);
    const wait = m ? Number(m[1]) : (payload.retry ?? 90);
    return new ApiError(429, "upstream", `训记接口限频——约 ${wait} 秒后再试（${raw.slice(0, 80)}）`);
  }
  return new ApiError(502, "upstream", `训记接口错误：${raw.slice(0, 150)}`);
}

/** key 指纹（读缓存分桶用）：每用户 key（REQ-042）下同日不同账号的数据必须隔离，
 * 缓存键带上 key 哈希前缀，防止 A 账号数据串给 B；指纹不出现在错误/日志 */
const keyTag = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 8);

async function xunjiPost<T = XunjiShell>(path: string, body: unknown, fetcher: FetchLike = defaultFetch, keyOverride?: string): Promise<T> {
  const key = keyOverride ?? requireKey();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(`${XUNJI_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let payload: XunjiShell;
    try {
      payload = JSON.parse(text) as XunjiShell;
    } catch {
      throw new ApiError(502, "upstream", `训记响应非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
    }
    // 实测：成功可能不带 success 字段，HTTP 200 + res 为数据（对象/数组）即成功；
    // 失败时 res 是错误文案字符串（too frequent 等）
    if (res.ok && typeof payload.res !== "string" && (payload.res !== undefined || payload.error === undefined)) return payload as T;
    throw toApiError(payload, res.status);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ApiError(504, "upstream", "训记接口超时（15s）");
    throw new ApiError(502, "upstream", `训记接口不可达：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 按日读缓存（官方规则：同一天 90 秒内不重复请求；写成功后以 res 覆盖） */
const readCache = new Map<string, { at: number; data: XunjiTrain[] }>();

export function xunjiCacheInvalidate(datestr: string) {
  // 缓存键带 key 指纹前缀（REQ-042）：按后缀匹配清掉所有账号该日的条目
  const suffix = `:${datestr}`;
  for (const k of readCache.keys()) if (k.endsWith(suffix)) readCache.delete(k);
}

/** 读某日训练（include_full_data：未打勾组/RPE/备注/心率）。实测 res 形状：{schema, datestr, limits, trains:[...]}。
 * key 为该用户的训记 apiKey（REQ-042）；缺省回落部署级 XUNJI_API_KEY（目录拉取等部署级操作） */
export async function readTrains(datestr: string, includeFull = true, fetcher: FetchLike = defaultFetch, key?: string): Promise<XunjiTrain[]> {
  const tag = keyTag(key ?? requireKey());
  const cacheKey = `${tag}:${datestr}`;
  const hit = readCache.get(cacheKey);
  if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) return hit.data;
  const payload = await xunjiPost<{ res: { trains?: XunjiTrain[] } | XunjiTrain[] }>("/api_trains_for_llm_v2", {
    schema_version: "train_open_api_v2",
    datestr,
    include_full_data: includeFull,
  }, fetcher, key);
  const trains = Array.isArray(payload.res) ? payload.res : (payload.res?.trains ?? []);
  // 容量上限：键是任意 datestr（chat 工具允许查任意日期），无界会常驻进程内存
  if (readCache.size >= 400) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of readCache) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    if (oldestKey) readCache.delete(oldestKey);
  }
  readCache.set(cacheKey, { at: Date.now(), data: trains });
  return trains;
}

/** 写训练（新建不带 localid / 更新带；≤4 条同日）。成功后用响应覆盖当日缓存 */
export async function upsertTrains(
  datestr: string,
  trains: XunjiTrain[],
  clientRequestId: string,
  fetcher: FetchLike = defaultFetch,
  key?: string,
): Promise<XunjiTrain[]> {
  if (trains.length < 1 || trains.length > 4) throw ApiError.badRequest("训记单次最多写入 4 条训练");
  const payload = await xunjiPost<{ res: { trains?: XunjiTrain[] } | XunjiTrain[] }>("/api_upsert_trains_for_llm_v2", {
    schema_version: "train_open_api_v2",
    client_request_id: clientRequestId,
    res: trains,
  }, fetcher, key);
  const normalized = Array.isArray(payload.res) ? payload.res : (payload.res?.trains ?? trains);
  const tag = keyTag(key ?? requireKey());
  readCache.set(`${tag}:${datestr}`, { at: Date.now(), data: normalized });
  return normalized;
}

/** 绑定前即时校验候选 key（REQ-042）：读哨兵日期——key 无效会得到「apikey invalid」抛 502，
 * 有效 key 返回空数据（2000-01-01 必无训练）。坏 key 不落库（与 Bitget 绑定同防线） */
export async function validateXunjiKey(key: string, fetcher: FetchLike = defaultFetch): Promise<void> {
  await xunjiPost("/api_trains_for_llm_v2", {
    schema_version: "train_open_api_v2",
    datestr: "2000-01-01",
    include_full_data: false,
  }, fetcher, key);
}

// ---------------------------------------------------------------------------
// 动作目录（官方名校验表；分层加载在 service.loadXunjiCatalog——本层只做外呼与规范化）
// ---------------------------------------------------------------------------

/** 目录条目（api_movement_catalog_for_llm_v2 规范化后；type 为肌群/分类标注） */
export interface XunjiCatalogMovement {
  name: string;
  type: string | null;
  exetype: string | null;
  aliases: string[];
}

/** 外呼拉取官方动作目录（无缓存——内存/DB 分层缓存由 service.loadXunjiCatalog 负责） */
export async function fetchCatalogMovements(fetcher: FetchLike = defaultFetch): Promise<XunjiCatalogMovement[]> {
  // 实测形状：{res:{schema:"movement_catalog_v1", movements:[{name, type, exetype, aliases:[...]}]}}
  const payload = await xunjiPost<{ res: { movements?: unknown[] } | unknown[] }>("/api_movement_catalog_for_llm_v2", {}, fetcher);
  const res = payload.res;
  const list: unknown[] = Array.isArray(res) ? res : ((res as { movements?: unknown[] })?.movements ?? []);
  const out: XunjiCatalogMovement[] = [];
  for (const row of list) {
    if (typeof row === "string") {
      out.push({ name: row, type: null, exetype: null, aliases: [] });
    } else if (row && typeof row === "object") {
      const r = row as { name?: unknown; type?: unknown; exetype?: unknown; aliases?: unknown };
      if (typeof r.name !== "string" || !r.name.trim()) continue;
      out.push({
        name: r.name.trim(),
        type: typeof r.type === "string" && r.type.trim() ? r.type.trim() : null,
        exetype: typeof r.exetype === "string" && r.exetype.trim() ? r.exetype.trim() : null,
        aliases: Array.isArray(r.aliases) ? r.aliases.filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => n.trim()) : [],
      });
    }
  }
  return out;
}

/** 目录 → 名字集合（官方名 + 别名一起展开；makeOfficialResolver / 匹配校验共用口径） */
export function catalogToNameSet(movements: XunjiCatalogMovement[]): Set<string> {
  const names = new Set<string>();
  for (const m of movements) {
    names.add(m.name);
    for (const a of m.aliases) names.add(a);
  }
  return names;
}

/** 跑步有氧日官方名解析（REQ-023 v1.1）：实测目录无逐字「跑步」条目（有氧分类下为「跑步（有氧）」），
 * 按分类优先级对齐目录内跑步条目：精确「跑步」→「有氧」→「计时动作」→「热身动作」（名字须以「跑步」开头）。
 * 目录不可得或无任何跑步类条目返回 null——调用方回退直写「跑步」（017 旧语义） */
export function resolveRunOfficialName(movements: XunjiCatalogMovement[]): string | null {
  let cardio: string | null = null;
  let timed: string | null = null;
  let warmup: string | null = null;
  for (const m of movements) {
    if (m.name === "跑步") return "跑步";
    if (!m.name.startsWith("跑步")) continue;
    if (m.type === "有氧" && cardio == null) cardio = m.name;
    else if (m.type === "计时动作" && timed == null) timed = m.name;
    else if (m.type === "热身动作" && warmup == null) warmup = m.name;
  }
  return cardio ?? timed ?? warmup;
}

/** 规则快速通道：用户确认别名 → 内置实测别名（XUNJI_NAME_ALIAS）→ 目录精确命中视为已消化；
 * 返回待确认/待 AI 匹配的残余名单（REQ-023 起 userAliases 优先级最高） */
export function ruleMatchOfficialNames(
  names: string[],
  catalog: Set<string>,
  userAliases: Record<string, string> = {},
): { matched: Map<string, string>; pending: string[] } {
  const matched = new Map<string, string>();
  const pending: string[] = [];
  for (const name of names) {
    const userAlias = userAliases[name];
    if (userAlias && (!catalog.size || catalog.has(userAlias))) {
      matched.set(name, userAlias);
      continue;
    }
    const alias = XUNJI_NAME_ALIAS[name];
    if (alias && catalog.has(alias)) {
      matched.set(name, alias);
      continue;
    }
    if (catalog.has(name)) continue; // 已是目录内的名字（官方名或别名原样可用）
    pending.push(name);
  }
  return { matched, pending };
}

/** 名单按目录/别名分流（REQ-023 同步前置解析）：resolved 进同步载荷，unmatched 交确认弹窗。
 * catalog 为空（目录不可得）时退回旧语义：内置别名照用，其余全部 unmatched */
export function splitOfficialNames(
  names: string[],
  catalog: Set<string>,
  userAliases: Record<string, string> = {},
): { resolved: Map<string, string>; unmatched: string[] } {
  const resolved = new Map<string, string>();
  const unmatched: string[] = [];
  for (const name of names) {
    const userAlias = userAliases[name];
    if (userAlias && (!catalog.size || catalog.has(userAlias))) {
      resolved.set(name, userAlias);
      continue;
    }
    const alias = XUNJI_NAME_ALIAS[name];
    if (alias && (!catalog.size || catalog.has(alias))) {
      resolved.set(name, alias);
      continue;
    }
    if (catalog.has(name)) {
      resolved.set(name, name);
      continue;
    }
    unmatched.push(name);
  }
  return { resolved, unmatched };
}

/** 把匹配到的官方名写回力量计划：name 替换为官方名，原名以「佳易名：xxx」并入 note（保序：原名标注在前）。
 * 官方名超 20 字（拾光动作名上限）跳过不改——防绕过落库校验导致后续草稿编辑被拒 */
export function renameExercisesToOfficial(content: StrengthPlanContent, mapping: Map<string, string>): StrengthPlanContent {
  if (!mapping.size) return content;
  return {
    ...content,
    exercises: content.exercises.map((e) => {
      const official = mapping.get(e.name);
      if (!official || official === e.name || [...official].length > 20) return e;
      const label = `佳易名：${e.name}`;
      const merged = e.note ? `${label}；${e.note}` : label;
      return { ...e, name: official, note: [...merged].slice(0, 60).join("") };
    }),
  };
}

/** 构造「拾光名 → 训记官方名」解析器：alias 优先 → 原名/别名任一命中 catalog 即可；
 * 都不命中抛错列名（官方规则：不确定时让用户确认，绝不编造） */
export function makeOfficialResolver(catalog: Set<string>): (name: string) => string {
  return (name: string) => {
    const alias = XUNJI_NAME_ALIAS[name];
    if (alias && catalog.has(alias)) return alias;
    if (catalog.has(name)) return name;
    if (alias && catalog.size === 0) return alias; // 目录不可用时兜底：仅信任实测确认的映射
    if (catalog.size === 0) return name;
    throw ApiError.badRequest(
      `动作「${name}」不在训记官方动作库（别名「${alias ?? "无"}」也未命中）——请改名或先在训记 App 确认可用动作名`,
    );
  };
}

/** 反向：训记官方名 → 拾光名（读回匹配用；无映射时原样返回） */
export function makeLocalResolver(): (official: string) => string {
  const reverse = new Map(Object.entries(XUNJI_NAME_ALIAS).map(([k, v]) => [v, k]));
  return (official: string) => reverse.get(official) ?? official;
}
