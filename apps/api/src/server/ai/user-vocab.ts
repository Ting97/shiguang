/**
 * 用户自定义类别注入（识别链路）：
 * - 日程活动分类：activities 表（预设改名 + 自定义）→「分类对照」/ Jev activity 闭集选项；
 *   识别结果归一 resolveActivityValue（精确 id → 精确名 → 包含模糊 → other）
 * - 花销分类：transactions 历史常用分类词表 →「常用分类」注入 / Jev fin_category 选项
 * 归一后的值恒为 activities.id（预设枚举 id 或自定义 uuid），time_blocks.activity_id 的
 * join（a.id = b.activity_id and a.user_id = b.user_id）对两类 id 都成立。
 */
import { pool } from "@/server/platform/db";

export interface UserActivityRow {
  id: string;
  name: string;
  isPreset: boolean;
}

/** 用户活动分类全集（预设在前，按 sort_order）；空表 = 新用户未初始化，调用方回落代码枚举 */
export async function listUserActivities(userId: string): Promise<UserActivityRow[]> {
  const { rows } = await pool.query(
    `select id, name, is_preset from activities where user_id = $1 order by is_preset desc, sort_order asc`,
    [userId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), isPreset: Boolean(r.is_preset) }));
}

/** 「分类对照」串：`sleep=睡眠、<uuid>=吉他`（预设用 id=改名后的名称，自定义用 uuid=名称） */
export function catListFromActivities(acts: UserActivityRow[]): string {
  // 名称切片防存量超长名（≤20 已在 create/update 校验）：catList 逐条进每次识别 prompt
  return acts.map((a) => `${a.id}=${String(a.name).slice(0, 20)}`).join("、");
}

/** 用户历史常用花销分类（频次降序 topN；条数上限在调用方钳制） */
export async function listUserFinanceCats(userId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const { rows } = await pool.query(
    `select category, count(*) as c from transactions
     where user_id = $1 and category is not null and category <> ''
     group by category order by c desc, category asc limit $2`,
    [userId, limit],
  );
  return rows.map((r) => String(r.category));
}

/** Jev activity 闭集追加选项：自定义分类 id →「自定义分类：名称」（预设九类的基础描述已在题目里） */
export function activityJevCriteria(acts: UserActivityRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of acts) {
    if (!a.isPreset && a.id !== "other") out[a.id] = `自定义分类：${a.name}`;
  }
  return out;
}

/** Jev fin_category 闭集追加选项：常用分类名 →「用户常用分类」（基础七类的说明已在题目里） */
export function financeJevCriteria(cats: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cats) {
    if (!["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "其他"].includes(c)) out[c] = "用户常用分类";
  }
  return out;
}

/** 模型输出的 activity 归一到用户活动 id：精确 id → 精确名 → 包含模糊（≥2 字）→ other */
export function resolveActivityValue(raw: string | null | undefined, acts: UserActivityRow[]): string {
  const v = String(raw ?? "").trim();
  if (!v) return "other";
  const lower = v.toLowerCase();
  const byId = acts.find((a) => a.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const byName = acts.find((a) => a.name.trim().toLowerCase() === lower);
  if (byName) return byName.id;
  if (v.length >= 2) {
    const fuzzy = acts.find((a) => a.name && (a.name.includes(v) || v.includes(a.name)));
    if (fuzzy) return fuzzy.id;
  }
  return "other";
}
