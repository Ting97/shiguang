"use client";

/** 行内小操作按钮（编辑/删除），悬停显示 */
export function RowAction({ onEdit, onDelete, editTitle = "修改", delTitle = "删除" }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editTitle?: string;
  delTitle?: string;
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
          title={delTitle}
          className="rounded px-1 py-0.5 text-[11px] text-ink-dim hover:text-danger"
        >
          🗑
        </button>
      )}
    </span>
  );
}
