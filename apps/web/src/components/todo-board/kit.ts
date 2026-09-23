import type { TodoItem, TodoRow } from "@/lib/types";
import type { Draft, View } from "./types";

/** todo-board 小工具（勾选圆圈/日期工具等与 todo-bits.tsx 共用的件直接引用既有文件，不复制） */

/** 智能列表定义：☀️ 今日（手动标记）/ ⭐ 重要 / 📋 全部 / ✓ 已完成 */
export const VIEWS: [View, string][] = [
  ["today", "☀️ 今日"],
  ["important", "⭐ 重要"],
  ["all", "📋 全部"],
  ["done", "✓ 已完成"],
];

export const EMPTY_DRAFT: Draft = { title: "", important: false, today: false, due: "", activityId: "", spaceId: "" };

/** 判断 id 是否为行动（子待办）：行内编辑据此决定是否提交 repeatDaily */
export function isChildId(id: string, todos: TodoItem[]): boolean {
  return todos.some((t) => t.children.some((c) => c.id === id));
}

/** 行是否已完成（菜单分支用） */
export const isDoneRow = (t: TodoRow) => t.status === "done";

/** 各视图空态文案 */
export const EMPTY_TEXT: Record<View, string> = {
  today: "今天还没安排 ☀️ —— 在上面添加 todo（会自动标记今日），或把 ⭐重要 / 📋全部 里的todo 标为今日",
  important: "还没有重要 todo ⭐ —— 添加时勾选「重要」，或把现有todo 标为重要",
  all: "暂无 todo —— 在上面添加一个，或在主页随口说一句（AI 会自动识别 todo）",
  done: "还没有已完成的 todo ✓",
};
