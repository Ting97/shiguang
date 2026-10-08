/**
 * 页面页脚徽章（REQ-全站页脚徽章）：每个页面最底部的居中小徽章「拾光 · <模块名>」，
 * = web 各页 footer 的 miniapp 统一形态（样式取自目标空间 sp-foot 首例）。
 */
import { View, Text } from "@tarojs/components";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";
import "./index.scss";

export default function PageFooter({ icon, label }: { icon: LucideIconName; label: string }) {
  return (
    <View className="pg-foot">
      <View className="chip pg-foot-chip">
        <LucideIcon name={icon} size={12} color="var(--ai)" />
        <Text>拾光 · {label}</Text>
      </View>
    </View>
  );
}
