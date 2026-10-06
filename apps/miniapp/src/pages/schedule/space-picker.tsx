/**
 * 空间关联弹层（= web space-picker.tsx 移动端底部弹层形态）：
 * 列出 active 空间供关联/切换；当前关联的是归档空间时置灰展示、仅可移除；
 * 底部「移除关联」（未关联时隐藏）。
 */
import { Text, View } from "@tarojs/components";
import LucideIcon from "../../components/lucide-icon";
import type { Space } from "./api";

export default function SpacePicker({
  spaces,
  currentId,
  onPick,
  onRemove,
  onClose,
}: {
  spaces: Space[];
  /** 当前关联的空间 id（null=未关联） */
  currentId: string | null;
  onPick: (spaceId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const current = spaces.find((s) => s.id === currentId) ?? null;
  const currentArchived = current?.status === "archived";
  const pickable = spaces.filter((s) => s.status === "active");

  return (
    <View>
      <View className="overlay" onTap={onClose} />
      <View className="sheet">
        <View className="sheet-bar" />
        <Text className="rm-head-title">关联目标空间</Text>
        <View className="rm-list">
          {pickable.map((s) => {
            const isCurrent = s.id === currentId;
            return (
              <View
                key={s.id}
                className={`rm-item ${isCurrent ? "current" : ""}`}
                hoverClass="press"
                hoverStayTime={80}
                onTap={() => !isCurrent && onPick(s.id)}
              >
                <View className="sp-icon" style={{ backgroundColor: `${s.color}26` }}>
                  <Text>{s.icon}</Text>
                </View>
                <Text className="rm-item-label grow">{s.name}</Text>
                {isCurrent && <Text className="sp-current-mark">已关联</Text>}
              </View>
            );
          })}
          {pickable.length === 0 && <Text className="sp-empty">还没有进行中的空间 —— 先到「目标」页创建</Text>}

          {/* 归档中的当前关联：置灰展示，不可新选（自身已不在 pickable 中） */}
          {currentArchived && current && (
            <View className="rm-item disabled">
              <View className="sp-icon gray" style={{ backgroundColor: `${current.color}26` }}>
                <Text>{current.icon}</Text>
              </View>
              <Text className="rm-item-label grow">{current.name}</Text>
              <Text className="sp-archived-mark">已归档</Text>
            </View>
          )}

          {currentId && (
            <View className="rm-item danger" hoverClass="press" hoverStayTime={80} onTap={onRemove}>
              <View className="rm-item-icon">
                <LucideIcon name="x" size={14} color="var(--danger)" />
              </View>
              <Text className="rm-item-label">移除关联</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
