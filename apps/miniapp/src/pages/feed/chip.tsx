/**
 * TagChip / FilterChip 的小程序等价物（= web components/tag-chip.tsx）。
 * README：chips 用全局 .chip / .chip-filter 词汇 + 语义色由页面给底/字色——
 * 这里按 web TONE_* 映射给内联 style（tinted 底色 rgba 固定、字色走主题令牌，深浅主题自适应）。
 */
import { View, Text } from "@tarojs/components";
import LucideIcon, { type LucideIconName } from "../../components/lucide-icon";

export type Tone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";

/** = web TONE_CHIP：透明度色值固定（叠在主题底色上，web 同款做法），文字色用主题令牌 */
const TONE_BG: Record<Tone, string> = {
  sky: "rgba(14, 165, 233, 0.15)",
  emerald: "rgba(16, 185, 129, 0.15)",
  amber: "rgba(245, 158, 11, 0.2)",
  rose: "rgba(244, 63, 94, 0.15)",
  violet: "rgba(139, 92, 246, 0.15)",
  slate: "var(--elevated)",
};
const TONE_TEXT: Record<Tone, string> = {
  sky: "var(--accent)",
  emerald: "var(--success)",
  amber: "var(--warn)",
  rose: "var(--danger)",
  violet: "var(--ai)",
  slate: "var(--ink-mute)",
};

/** 展示型标签：icon(emoji) / lucide(lucide 图标名) + 文本，rounded-lg tinted 底；size sm=卡片头小标签（= web TagChip） */
export function TagChip(props: {
  icon?: string;
  /** lucide 风格图标（REQ-009 换标）：传 lucide 图标名时优先于 emoji icon 渲染 */
  lucide?: LucideIconName;
  label: string;
  tone?: Tone;
  size?: "sm" | "md";
  maxWidth?: boolean;
}) {
  const { icon, lucide, label, tone = "slate", size = "md", maxWidth } = props;
  return (
    <View
      className={`tag-chip tag-chip-${size}${maxWidth ? " tag-chip-max" : ""}`}
      style={{ backgroundColor: TONE_BG[tone], color: TONE_TEXT[tone] }}
    >
      {lucide ? (
        <LucideIcon name={lucide} size={11} color={TONE_TEXT[tone]} />
      ) : icon ? (
        <Text className="tag-chip-icon">{icon}</Text>
      ) : null}
      <Text className="tag-chip-label">{label}</Text>
    </View>
  );
}

/** 交互型过滤 chip（= web FilterChip variant="filter"）：未激活描边 ghost 底，激活 sky→indigo 渐变白字 */
export function FilterChip(props: {
  label: string;
  icon?: string;
  active: boolean;
  onTap: () => void;
}) {
  const { label, icon, active, onTap } = props;
  return (
    <View
      className={`space-chip${active ? " space-chip-active" : ""}`}
      hoverClass="press"
      hoverStayTime={80}
      onTap={onTap}
    >
      {icon ? <Text className="space-chip-icon">{icon}</Text> : null}
      <Text>{label}</Text>
    </View>
  );
}
