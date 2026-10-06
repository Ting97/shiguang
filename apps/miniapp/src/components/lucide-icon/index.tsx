/**
 * 小程序 lucide 线性图标组件（REQ-009 滚动：与 web 图标体系对齐）。
 * weapp 无 SVG 组件：以官方 lucide SVG 为 CSS mask + background-color: currentColor 渲染，
 * 颜色随主题令牌（color 传 var(--xxx) 即可跟随深浅主题）。
 *
 * 用法：<LucideIcon name="pencil" size={13} color="var(--ink-mute)" />
 * name 取 icons.generated.ts 的键（snake_case，如 trash_2 / check_circle_2）。
 */
import { View } from "@tarojs/components";
import { ICONS } from "./icons.generated";

export type LucideIconName = keyof typeof ICONS;

export default function LucideIcon({
  name,
  size = 26, // px 数（web 语义），×2 = weapp 单位
  color = "var(--ink-mute)",
  className = "",
}: {
  name: LucideIconName;
  /** web 像素语义尺寸，内部 ×2（designWidth 750 约定） */
  size?: number;
  /** 任意 CSS 颜色（支持 var 令牌）；mask 内黑色被染成该色 */
  color?: string;
  className?: string;
}) {
  const url = ICONS[name];
  if (!url) return null;
  return (
    <View
      className={`lucide-icon ${className}`}
      style={{
        width: `${size * 2}px`,
        height: `${size * 2}px`,
        color,
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
/* mask 渲染基类（wxss 放 scss 更贴合工程，这里由页面级 scss 提供 .lucide-icon） */
