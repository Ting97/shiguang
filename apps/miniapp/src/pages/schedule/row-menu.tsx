/**
 * 行操作菜单卡片（= web row-menu.tsx 移动端形态：底部弹层）：
 * 点行右侧「⋯」弹出；菜单项点击即关菜单再执行（两步确认项除外——
 * 删除的确认对话在 removeTodo 里用 Taro.showModal 完成，= web window.confirm）。
 */
import { Text, View } from "@tarojs/components";
import LucideIcon, { type LucideIconName } from "../../components/lucide-icon";
import type { TodoRow } from "./api";

interface MenuItemProps {
  icon: LucideIconName;
  label: string;
  hint?: string;
  extra?: string;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onTap: () => void;
}

/** 菜单单项目：点击即关菜单再执行动作（danger 红、active 已开启徽标、busy 转圈文案） */
function MenuItem({ icon, label, hint, extra, danger, active, disabled, busy, onTap }: MenuItemProps) {
  return (
    <View
      className={`rm-item ${danger ? "danger" : ""} ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
      hoverClass={disabled ? "none" : "press"}
      hoverStayTime={80}
      onTap={() => {
        if (disabled) return;
        onTap();
      }}
    >
      <View className="rm-item-icon">
        <LucideIcon name={busy ? "hourglass" : icon} size={14} color={danger ? "var(--danger)" : busy ? "var(--warn)" : "var(--ink-mute)"} />
      </View>
      <View className="rm-item-body">
        <Text className="rm-item-label">{label}</Text>
        {hint && <Text className="rm-item-hint">{hint}</Text>}
      </View>
      {extra && <Text className="rm-item-extra">{extra}</Text>}
      {active && <Text className="rm-item-on">已开启</Text>}
    </View>
  );
}

export interface MenuRowInfo {
  todo: TodoRow;
  isChild: boolean;
  parentTitle?: string;
}

export interface RowMenuActions {
  decomposingId: string | null;
  patchTodo: (id: string, body: Record<string, unknown>, okText?: string) => Promise<boolean>;
  decompose: (t: TodoRow, isAction: boolean, mode?: "replace" | "append") => Promise<void>;
  removeTodo: (t: TodoRow, isChild: boolean) => Promise<void>;
  pendingCount: (t: TodoRow) => number;
}

export function RowMenu({
  menuRow,
  onClose,
  decomposingId,
  patchTodo,
  decompose,
  removeTodo,
  pendingCount,
  startEdit,
  openNote,
  onPickSpace,
  onAddAction,
}: {
  menuRow: MenuRowInfo;
  onClose: () => void;
  startEdit: (t: TodoRow) => void;
  openNote: (t: TodoRow) => void;
  onPickSpace: (t: TodoRow) => void;
  onAddAction: (t: TodoRow) => void;
} & RowMenuActions) {
  const t = menuRow.todo;
  const isDone = t.status === "done";
  return (
    <View>
      <View className="overlay" onTap={onClose} />
      <View className="sheet row-menu">
        {/* 拖拽指示条 */}
        <View className="sheet-bar" />
        <View className="rm-head">
          <Text className="rm-head-title">{t.title}</Text>
          {menuRow.isChild && menuRow.parentTitle && <Text className="rm-head-parent">{menuRow.parentTitle}</Text>}
        </View>
        <View className="rm-list">
          {menuRow.isChild ? (
            <>
              <MenuItem icon="pencil" label="编辑标题 / 描述" onTap={() => openNote(t)} />
              {!isDone && (
                <MenuItem
                  icon="repeat"
                  label={t.repeat_daily ? "关闭每日重复" : "每日重复（次日 6 点恢复）"}
                  active={t.repeat_daily}
                  extra={t.repeat_done_count > 0 ? `已完成 ×${t.repeat_done_count}` : undefined}
                  onTap={() => void patchTodo(t.id, { repeatDaily: !t.repeat_daily }, t.repeat_daily ? "已关闭每日重复" : "🔁 已设为每日重复")}
                />
              )}
              {!isDone && (
                <MenuItem
                  icon="sparkles"
                  label="AI 细化为更小行动"
                  hint="插入到该行动之后"
                  disabled={decomposingId === t.id}
                  busy={decomposingId === t.id}
                  onTap={() => void decompose(t, true)}
                />
              )}
              <MenuItem icon="trash_2" label="删除行动" danger onTap={() => void removeTodo(t, true)} />
            </>
          ) : (
            <>
              <MenuItem icon="pencil" label="编辑标题与时间" onTap={() => startEdit(t)} />
              {!isDone && (
                <MenuItem
                  icon="star"
                  label={t.is_important ? "取消重要标记" : "标记为重要"}
                  active={t.is_important}
                  onTap={() => void patchTodo(t.id, { important: !t.is_important }, t.is_important ? "已取消重要" : "⭐ 已标记为重要")}
                />
              )}
              {!isDone && (
                <MenuItem
                  icon="sun"
                  label={t.today_tag_date ? "移出今日" : "标记为今日"}
                  hint="今日标记跨零点自动失效"
                  active={!!t.today_tag_date}
                  onTap={() => void patchTodo(t.id, { today: !t.today_tag_date }, t.today_tag_date ? "已移出今日" : "☀️ 已加入今日")}
                />
              )}
              <MenuItem icon="target" label="关联空间" onTap={() => onPickSpace(t)} />
              {!isDone && t.kind === "todo" && <MenuItem icon="plus" label="添加行动" onTap={() => onAddAction(t)} />}
              {!isDone &&
                (pendingCount(t) === 0 ? (
                  <MenuItem
                    icon="sparkles"
                    label="AI 拆解为可执行的行动"
                    disabled={decomposingId === t.id}
                    busy={decomposingId === t.id}
                    onTap={() => void decompose(t, false)}
                  />
                ) : (
                  <>
                    {/* 已有未完成行动：给出显式二选一（替代原 confirm 的双语义） */}
                    <Text className="rm-note">已有 {pendingCount(t)} 个未完成行动：</Text>
                    <MenuItem
                      icon="sparkles"
                      label="重新生成"
                      hint="清空未完成行动后重拆（已完成保留）"
                      disabled={decomposingId === t.id}
                      busy={decomposingId === t.id}
                      onTap={() => void decompose(t, false, "replace")}
                    />
                    <MenuItem
                      icon="plus"
                      label="追加到末尾"
                      hint="保留现有行动，新行动接在后面"
                      disabled={decomposingId === t.id}
                      onTap={() => void decompose(t, false, "append")}
                    />
                  </>
                ))}
              {isDone && <MenuItem icon="rotate_ccw" label="恢复为未完成" onTap={() => void patchTodo(t.id, { undone: true }, `↩️ 「${t.title}」已恢复`)} />}
              <MenuItem icon="trash_2" label="删除 todo" hint="其下行动一并删除" danger onTap={() => void removeTodo(t, false)} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}
