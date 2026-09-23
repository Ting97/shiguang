import type { TodoRow } from "@/lib/types";

/** todo-board 拆分件共享类型（结构逐字对应拆分前的内联定义，行为零变化） */

/** 智能列表视图 */
export type View = "today" | "important" | "all" | "done";

/** 轻提示：ok=成功（绿）/ 否则失败（红）；null=隐藏 */
export type Msg = { ok: boolean; text: string } | null;

/** 添加行草稿（due 为 datetime-local 值，空串=无截止；activityId "other" 默认；spaceId ""=不关联空间） */
export interface Draft {
  title: string;
  important: boolean;
  today: boolean;
  due: string;
  activityId: string; // "other" 默认
  spaceId: string; // ""=不关联空间
}

/** 行操作菜单卡片状态（点「⋯」弹出；桌面锚定浮层 / 移动端底部弹层） */
export interface MenuRowInfo {
  todo: TodoRow;
  isChild: boolean;
  parentTitle?: string;
}

/** 行动（子任务）输入行的控制句柄（入口组装后经 props 传给子区，不引入新状态管理） */
export interface SubtaskCtl {
  parentId: string | null; // 正在添加子任务的任务
  title: string;
  setTitle: (t: string) => void;
  open: (id: string) => void;
  close: () => void;
  add: (parentId: string) => void;
  setMsg: (m: Msg) => void;
}
