/** 空间详情页共享类型（自 detail.tsx 拆出） */
import type { TodoRow } from "@/lib/types";

/** 轻提示（页面顶部 banner；null=隐藏） */
export type Msg = { ok: boolean; text: string } | null;

/** 浮层锚定坐标（桌面锚定浮层 / 移动端底部弹层） */
export type Pos = { top: number; left: number };

/** 行操作菜单卡片状态（点「⋯」弹出） */
export type MenuRowState = { todo: TodoRow; isChild: boolean };

/** N2：分区 tab */
export type SpaceTab = "todo" | "reflection" | "moments";

/** N2：感悟编辑态（编辑携带全文，null=新建） */
export type EditingReflection = { id: string; content: string };
