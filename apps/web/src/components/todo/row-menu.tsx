"use client";

/**
 * TODO/行动行操作菜单——全站唯一权威实现（REQ-009 滚动）。
 * 入口：日程 todo-board、空间详情、今日行动……点击行的「⋯」弹出本菜单；
 * 桌面锚定浮层 / 移动端底部弹层，portal 到 body。
 * handlers 缺席时对应项隐藏（见 TodoMenuActions）。
 */
import { createPortal } from "react-dom";
import { Pencil, Plus, Repeat, RotateCcw, Sparkles, Star, Sun, Target, Trash2 } from "lucide-react";
import { Dismissable } from "../dismissable";
import { MenuItem, type TodoMenuActions, type TodoMenuInfo } from "./menu-item";

export type { TodoMenuActions, TodoMenuInfo, TodoMenuTarget } from "./menu-item";

const isDone = (t: { status: string }) => t.status === "done";

export function TodoRowMenu({
  info,
  menuPos,
  onClose,
  actions,
}: {
  info: TodoMenuInfo;
  /** 桌面锚定坐标（null=仅移动端形态由布局兜底） */
  menuPos: { top: number; left: number } | null;
  onClose: () => void;
  actions: TodoMenuActions;
}) {
  const { todo: t, isChild, parentTitle } = info;
  const close = onClose;
  const decomposing = actions.decomposingId === t.id;

  return createPortal(
    <Dismissable
      onClose={onClose}
      className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-line-soft bg-elevated p-3 safe-bottom shadow-2xl shadow-scrim/70 sm:inset-x-auto sm:bottom-auto sm:w-56 sm:rounded-xl sm:p-2"
      style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
    >
      {/* 移动端拖拽指示条 */}
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-soft sm:hidden" />
      <p className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <span className="min-w-0 flex-1 truncate text-micro font-medium text-ink-dim">{t.title}</span>
        {isChild && parentTitle && (
          <span className="max-w-24 shrink-0 truncate text-badge text-ink-faint">{parentTitle}</span>
        )}
      </p>
      <div className="space-y-0.5">
        {isChild ? (
          <>
            {actions.openNote && (
              <MenuItem closeMenu={close} icon={<Pencil size={14} />} label="编辑标题 / 描述" onClick={() => actions.openNote!(t)} />
            )}
            {actions.patch && t.repeat_daily !== undefined && !isDone(t) && (
              <MenuItem
                closeMenu={close}
                icon={<Repeat size={14} className="text-success" />}
                label={t.repeat_daily ? "关闭每日重复" : "每日重复（次日 6 点恢复）"}
                active={!!t.repeat_daily}
                extra={t.repeat_done_count ? `已完成 ×${t.repeat_done_count}` : undefined}
                onClick={() => actions.patch!(t.id, { repeatDaily: !t.repeat_daily }, t.repeat_daily ? "已关闭每日重复" : "🔁 已设为每日重复")}
              />
            )}
            {actions.decompose && !isDone(t) && (
              <MenuItem
                closeMenu={close}
                icon={<Sparkles size={14} />}
                label="AI 细化为更小行动"
                hint="插入到该行动之后"
                disabled={decomposing}
                busy={decomposing}
                onClick={() => actions.decompose!(t, true)}
              />
            )}
            {actions.remove && (
              <MenuItem closeMenu={close} icon={<Trash2 size={14} />} label="删除行动" danger onClick={() => actions.remove!(t, true)} />
            )}
          </>
        ) : (
          <>
            {actions.startEdit && (
              <MenuItem closeMenu={close} icon={<Pencil size={14} />} label="编辑标题与时间" onClick={() => actions.startEdit!(t)} />
            )}
            {actions.patch && t.is_important !== undefined && !isDone(t) && (
              <MenuItem
                closeMenu={close}
                icon={<Star size={14} />}
                label={t.is_important ? "取消重要标记" : "标记为重要"}
                active={!!t.is_important}
                onClick={() => actions.patch!(t.id, { important: !t.is_important }, t.is_important ? "已取消重要" : "⭐ 已标记为重要")}
              />
            )}
            {actions.patch && t.today_tag_date !== undefined && !isDone(t) && (
              <MenuItem
                closeMenu={close}
                icon={<Sun size={14} />}
                label={t.today_tag_date ? "移出今日" : "标记为今日"}
                hint="今日标记跨零点自动失效"
                active={!!t.today_tag_date}
                onClick={() => actions.patch!(t.id, { today: !t.today_tag_date }, t.today_tag_date ? "已移出今日" : "☀️ 已加入今日")}
              />
            )}
            {actions.pickSpace && (
              <MenuItem closeMenu={close} icon={<Target size={14} />} label="关联空间" onClick={() => actions.pickSpace!(t)} />
            )}
            {actions.addAction && !isDone(t) && t.kind !== "action" && (
              <MenuItem closeMenu={close} icon={<Plus size={14} />} label="添加行动" onClick={() => actions.addAction!(t)} />
            )}
            {actions.decompose &&
              !isDone(t) &&
              ((actions.pendingCount?.(t) ?? 0) === 0 ? (
                <MenuItem
                  closeMenu={close}
                  icon={<Sparkles size={14} />}
                  label="AI 拆解为可执行的行动"
                  disabled={decomposing}
                  busy={decomposing}
                  onClick={() => actions.decompose!(t, false)}
                />
              ) : (
                /* 已有未完成行动：显式二选一（替代原 confirm「确定=重生成/取消=追加」的双语义） */
                <>
                  <p className="px-2.5 pt-1.5 text-badge text-ink-faint">已有 {actions.pendingCount!(t)} 个未完成行动：</p>
                  <MenuItem
                    closeMenu={close}
                    icon={<Sparkles size={14} />}
                    label="重新生成"
                    hint="清空未完成行动后重拆（已完成保留）"
                    disabled={decomposing}
                    busy={decomposing}
                    onClick={() => actions.decompose!(t, false, "replace")}
                  />
                  <MenuItem
                    closeMenu={close}
                    icon={<Plus size={14} />}
                    label="追加到末尾"
                    hint="保留现有行动，新行动接在后面"
                    disabled={decomposing}
                    onClick={() => actions.decompose!(t, false, "append")}
                  />
                </>
              ))}
            {actions.patch && isDone(t) && (
              <MenuItem closeMenu={close} icon={<RotateCcw size={14} />} label="恢复为未完成" onClick={() => actions.patch!(t.id, { undone: true }, `↩️ 「${t.title}」已恢复`)} />
            )}
            {actions.remove && (
              <MenuItem closeMenu={close} icon={<Trash2 size={14} />} label="删除 todo" hint="其下行动一并删除" danger onClick={() => actions.remove!(t, false)} />
            )}
          </>
        )}
      </div>
    </Dismissable>,
    document.body,
  );
}
