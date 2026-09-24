"use client";

/** 行内小操作按钮（编辑/删除），悬停显示；删除为两步确认（armed 时按钮变「确认删除?」） */
export function RowAction({ onEdit, onDelete, editTitle = "修改", delTitle = "删除", armed = false }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editTitle?: string;
  delTitle?: string;
  /** 删除待确认态（3 秒内再点执行） */
  armed?: boolean;
}) {
  return (
    <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
      {onEdit && (
        <button
          onClick={onEdit}
          title={editTitle}
          className="rounded px-1 py-0.5 text-[11px] text-ink-dim hover:text-accent"
        >
          ✏️
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title={armed ? "3 秒内再点确认删除" : delTitle}
          className={`rounded px-1 py-0.5 text-[11px] ${armed ? "bg-rose-500/15 font-medium text-danger" : "text-ink-dim hover:text-danger"}`}
        >
          {armed ? "确认删除?" : "🗑"}
        </button>
      )}
    </span>
  );
}
