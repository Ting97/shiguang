import type { Activity, FeedMoment } from "@/lib/types";

/**
 * moment-feed 拆分模块的共享类型。
 * 入口 props 结构与拆分前完全一致（page.tsx 引用入口的默认导出）。
 */

/** MomentFeed 入口 props（原 moment-feed.tsx 的 Props） */
export interface MomentFeedProps {
  moments: FeedMoment[];
  activities: Activity[];
  onRefresh: () => Promise<void>;
  /** 还有多少条未展示（>0 显示「加载更多」按钮） */
  moreCount?: number;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** 搜索模式：空态文案与常规不同 */
  searching?: boolean;
  searchKeyword?: string;
}

/** 卡内操作反馈：识别/手动添加/编辑/删除的就地提示 */
export type CardMsg = { ok: boolean; text: string } | null;

/** 卡内操作统一执行器：执行 fn → 成功/失败消息就地展示 → 刷新 */
export type RunFn = (fn: () => Promise<string>) => Promise<void>;

/** 带确认的删除：window.confirm 通过后走 run */
export type DelFn = (message: string, fn: () => Promise<unknown>) => Promise<void> | undefined;

/** 卡片头部意图标签（todo/日程/心情/动态） */
export interface IntentTag {
  icon: string;
  label: string;
  tone: "sky" | "violet" | "slate";
}

/** 浮层锚定坐标（portal 菜单的 fixed 定位；null=移动端交由菜单自行定位） */
export type MenuPos = { top: number; left: number } | null;
