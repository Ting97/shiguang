"use client";

import { Pencil, Trash2 } from "lucide-react";

/** 行内小操作按钮（编辑/删除）：hover 设备悬停显示；触屏常显（CSS @media hover:none 强制，
 *  此前触屏直接不渲染导致移动端删除入口不可达）。删除为两步确认（armed 时变「确认删除?」） */
export function RowAction({ onEdit, onDelete, armed = false }: {
  onEdit?: () => void;
  onDelete?: () => void;
  /** 删除待确认态（3 秒内再点执行） */
  armed?: boolean;
}) {
  return (
    <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
      {onEdit && (
        <button
          onClick={(e) => {
            // 触屏（hover:none 常显）下点击会冒泡到行 onClick 再弹 RowActionMenu，盖住刚打开的行内编辑表单
            e.stopPropagation();
            onEdit();
          }}
          title="修改"
          className="tap-lg press rounded px-1 py-0.5 text-ink-dim hover:text-accent"
        >
          <Pencil size={12} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={armed ? "3 秒内再点确认删除" : "删除"}
          className={`tap-lg press flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-none ${armed ? "bg-rose-500/15 text-danger" : "text-ink-dim hover:text-danger"}`}
        >
          {armed ? "确认删除?" : <Trash2 size={12} />}
        </button>
      )}
    </span>
  );
}
