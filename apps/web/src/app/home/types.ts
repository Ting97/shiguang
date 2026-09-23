import type { Dispatch, SetStateAction } from "react";

/** 首页拆分后的共享类型（page.tsx 与 home/ 子组件共用） */

/** 桌面输入区随附图片的状态机：ready 待发布 / uploading 上传中 / error 失败可重试 */
export interface DesktopImage {
  file: File;
  url: string;
  status: "ready" | "uploading" | "error";
}

/** 全局提示条消息（null = 不展示） */
export type Msg = { ok: boolean; text: string } | null;

/** 提示条 setState（页面各区块统一通过它上报成功/失败消息） */
export type Notify = Dispatch<SetStateAction<Msg>>;

/** 日程行内编辑草稿（HH:MM 字符串时间 + 活动Id） */
export interface BlockDraft {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}
