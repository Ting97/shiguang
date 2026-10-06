import Taro from "@tarojs/taro";

/**
 * 识别/行动行操作菜单（全端统一交互：编辑/删除图标默认隐藏，点行弹出）。
 * - 有编辑入口才给「✏️ 编辑」项
 * - 删除走模态二次确认（防误触，等价 web 的两步删除语义）
 * - 用户取消 ActionSheet 静默返回
 */
export async function rowMenu(label: string, onEdit: (() => void) | null, onDelete: () => void): Promise<void> {
  try {
    const items = onEdit ? ["✏️ 编辑", "🗑 删除"] : ["🗑 删除"];
    const r = await Taro.showActionSheet({ itemList: items });
    if (onEdit && r.tapIndex === 0) {
      onEdit();
      return;
    }
    const c = await Taro.showModal({
      title: "删除确认",
      content: `确定删除这条${label}？删除后不可恢复。`,
      confirmColor: "#f43f5e",
    });
    if (c.confirm) onDelete();
  } catch {
    /* 用户取消 ActionSheet */
  }
}
