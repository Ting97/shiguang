import { pool } from "@/server/platform/db";

/** 预设活动分类（与 packages/db/schema.sql 同源：新用户注册后播种自己的九大分类） */
export const PRESET_ACTIVITIES: Array<{
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultMin: number;
  sortOrder: number;
}> = [
  { id: "sleep",   name: "睡眠", icon: "😴", color: "#6366f1", defaultMin: 480, sortOrder: 1 },
  { id: "work",    name: "工作", icon: "💼", color: "#0ea5e9", defaultMin: 60,  sortOrder: 2 },
  { id: "study",   name: "学习", icon: "📚", color: "#10b981", defaultMin: 60,  sortOrder: 3 },
  { id: "fitness", name: "健身", icon: "💪", color: "#f59e0b", defaultMin: 60,  sortOrder: 4 },
  { id: "social",  name: "社交", icon: "👥", color: "#ec4899", defaultMin: 60,  sortOrder: 5 },
  { id: "fun",     name: "娱乐", icon: "🎮", color: "#8b5cf6", defaultMin: 30,  sortOrder: 6 },
  { id: "chores",  name: "家务", icon: "🧹", color: "#84cc16", defaultMin: 60,  sortOrder: 7 },
  { id: "commute", name: "通勤", icon: "🚌", color: "#78716c", defaultMin: 30,  sortOrder: 8 },
  { id: "other",   name: "其他", icon: "📌", color: "#64748b", defaultMin: 30,  sortOrder: 9 },
];

/** 为用户播种预设分类（幂等：已存在的不动） */
export async function seedPresetActivities(userId: string) {
  for (const a of PRESET_ACTIVITIES) {
    await pool.query(
      `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (id, user_id) do nothing`,
      [a.id, userId, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
    );
  }
}
