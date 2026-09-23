import { pool } from "@/server/platform/db";
import { chat, extractJson } from "@shiguangri/ai";
import { assembleUserPrompt, getPromptBundle } from "@/server/ai/prompts";

/**
 * 复盘输入基建（review v3）：原始明细行格式化、下层小结链、用户画像读写。
 * 目标：输入随周期范围渐进变丰满（原文+日程+待办+小结链+画像），让 AI 越用越懂用户。
 */

// 各周期原始动态行上限（day 自然量不设限；year 走抽样）
export const ENTRY_CAPS = { week: 200, month: 300, year: 60 } as const;
export const BLOCK_CAPS = { week: 100, month: 150, year: 100 } as const;
export const TODO_CAPS = { week: 100, month: 150, year: 100 } as const;

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + "…" : s);
const pad2 = (n: number) => String(n).padStart(2, "0");

export interface EntryRow {
  created_at: string | Date;
  raw_text: string;
  mood?: string | null;
  mood_score?: number | null;
}

/** 原始动态行：`MM-DD HH:MM 「原文」(心情:愉快 +40)`——发布时间+原文+心情一次给全 */
export function entryLines(rows: EntryRow[]): string[] {
  return rows.map((r) => {
    const d = new Date(r.created_at);
    const mood = r.mood ? `(心情:${r.mood}${r.mood_score != null ? ` ${r.mood_score > 0 ? "+" : ""}${r.mood_score}` : ""})` : "";
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} 「${clip(r.raw_text)}」${mood}`;
  });
}

/** 心情强度优先抽样（年报用）：|mood_score| 大者优先、按月轮转均匀铺开，最后按时间排序 */
export function sampleEntryRows<T extends EntryRow>(rows: T[], n: number): T[] {
  const pri = (r: T) => (r.mood_score != null ? Math.abs(r.mood_score) : -1) * 1000 + clip(r.raw_text, 60).length;
  const byMonth = new Map<number, T[]>();
  for (const r of rows) {
    const m = new Date(r.created_at).getMonth();
    const list = byMonth.get(m) ?? [];
    list.push(r);
    byMonth.set(m, list);
  }
  for (const list of byMonth.values()) list.sort((a, b) => pri(b) - pri(a));
  const out: T[] = [];
  let added = true;
  while (out.length < n && added) {
    added = false;
    for (const list of byMonth.values()) {
      const next = list.shift();
      if (next) {
        out.push(next);
        added = true;
        if (out.length >= n) break;
      }
    }
  }
  return out.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
}

export interface BlockRow {
  start_at: string | Date;
  end_at: string | Date;
  title: string;
  icon: string;
  name: string;
}

/** 日程块行：`MM-DD HH:MM-HH:MM 💼工作·开会` */
export function blockLines(rows: BlockRow[]): string[] {
  return rows.map((r) => {
    const s = new Date(r.start_at);
    const e = new Date(r.end_at);
    const sameDay = s.toDateString() === e.toDateString();
    const day = `${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
    const hm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const span = sameDay ? `${hm(s)}-${hm(e)}` : `${hm(s)}-次日${hm(e)}`;
    return `${day} ${span} ${r.icon}${r.name}${r.title && r.title !== r.name ? `·${clip(r.title, 16)}` : ""}`;
  });
}

export interface TodoRow {
  done_at: string | Date | null;
  title: string;
}

/** 完成待办行：`✅ MM-DD HH:MM 标题` */
export function todoDoneLines(rows: TodoRow[]): string[] {
  return rows
    .filter((r) => r.done_at)
    .map((r) => {
      const d = new Date(r.done_at!);
      return `✅ ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${clip(r.title, 30)}`;
    });
}

/** 行列表截断：超限截断并附注，让模型知道数据被裁剪过 */
export function withCap(lines: string[], cap: number, label: string): string[] {
  if (lines.length <= cap) return lines;
  return [...lines.slice(0, cap), `（另有 ${lines.length - cap} 条${label}未展示）`];
}

export interface ChainKey {
  key: string;
  label: string;
}

/** 下层小结链：周←7个日小结、月←各周小结、年←12个月报。只取已有缓存，缺失跳过 */
export async function fetchChainSummaries(
  userId: string,
  kind: "week" | "month" | "year",
  keys: ChainKey[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const childKind = kind === "week" ? "day" : kind === "month" ? "week" : "month";
  const { rows } = await pool.query(
    `select period_key, review from review_caches where user_id = $1 and kind = $2 and period_key = any($3::text[])`,
    [userId, childKind, keys.map((k) => k.key)],
  );
  const byKey = new Map(rows.map((r) => [r.period_key, r.review as { summary?: string }]));
  const out: string[] = [];
  for (const { key, label } of keys) {
    const summary = byKey.get(key)?.summary;
    if (summary) out.push(`${label}：${summary}`);
  }
  return out;
}

const PROFILE_BUCKETS: [keyof UserProfileShape, string][] = [
  ["habits", "习惯"],
  ["preferences", "偏好"],
  ["patterns", "规律"],
  ["facts", "事实"],
];

interface UserProfileShape {
  habits?: string[];
  preferences?: string[];
  patterns?: string[];
  facts?: string[];
}

/** 读用户画像并拼成提示词注入段（无画像返回 null） */
export async function loadProfileBlock(userId: string): Promise<string | null> {
  const { rows } = await pool.query(`select profile from user_ai_profiles where user_id = $1`, [userId]);
  const p = rows[0]?.profile as UserProfileShape | undefined;
  if (!p) return null;
  const parts = PROFILE_BUCKETS.map(([k, label]) => {
    const list = p[k];
    return Array.isArray(list) && list.length ? `${label}：${list.filter((x) => typeof x === "string").join("；")}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function validProfile(p: unknown, budgetMax = 40): UserProfileShape | null {
  if (typeof p !== "object" || p === null) return null;
  const out: UserProfileShape = {};
  let total = 0;
  for (const [k] of PROFILE_BUCKETS) {
    const list = (p as Record<string, unknown>)[k];
    if (Array.isArray(list)) {
      const items = list.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => clip(x.trim(), 40));
      if (items.length) {
        (out[k] as string[]) = items;
        total += items.length;
      }
    }
  }
  if (total === 0) return null;
  // 总量裁剪：上限由注入配置控制（profileItems，默认 40）
  let budget = budgetMax;
  for (const [k] of PROFILE_BUCKETS) {
    const list = out[k];
    if (!list) continue;
    if (list.length > budget) {
      out[k] = list.slice(0, budget);
      budget = 0;
    } else {
      budget -= list.length;
    }
  }
  return out;
}

/** 复盘 JSON 调用：chat → 解析失败带错误说明重问一次（与识别链路的自修复重问同思路） */
export async function chatReviewJson<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens: number;
  timeoutMs: number;
  onUsage?: (u: { prompt_tokens: number; completion_tokens: number }) => void;
}): Promise<T> {
  let raw = await chat({
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature ?? 0.4,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    onUsage: opts.onUsage,
  });
  try {
    return extractJson(raw) as T;
  } catch (first) {
    const repairMsg = `${opts.user}\n\n你上次的输出不是合法 JSON（${String(first).slice(0, 120)}）。请修正后重新输出完整 JSON：结构不变、只输出 JSON、字符串内不得包含未转义的英文双引号或换行。`;
    raw = await chat({
      system: opts.system,
      user: repairMsg,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      onUsage: opts.onUsage,
    });
    return extractJson(raw) as T;
  }
}

/** 月报生成后合并更新用户画像（旧画像+本月材料→新画像 upsert）；失败静默不影响复盘主流程 */
export async function updateProfileFromReview(
  userId: string,
  period: string,
  factsText: string,
  reviewText: string,
): Promise<void> {
  try {
    // 输入装配（3-A）：profile_merge 三要素必需；画像条数上限可调（caps.profileItems）
    const bundle = await getPromptBundle("profile_merge");
    const old = await loadProfileBlock(userId);
    const userPrompt = await assembleUserPrompt("profile_merge", bundle, {
      oldProfile: old ?? "（暂无，首次建立）",
      period,
      factsText: clip(factsText, 1600),
      reviewText: clip(reviewText, 1200),
    }, { userId });
    const raw = await chat({
      system: bundle.system,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs: 45_000,
    });
    const profile = validProfile(extractJson(raw), bundle.config.caps.profileItems);
    if (!profile) return;
    await pool.query(
      `insert into user_ai_profiles (user_id, profile, updated_at) values ($1,$2,now())
       on conflict (user_id) do update set profile = $2, updated_at = now()`,
      [userId, JSON.stringify(profile)],
    );
  } catch (e) {
    console.warn("[review] 画像更新失败（忽略）：", String(e).slice(0, 160));
  }
}
