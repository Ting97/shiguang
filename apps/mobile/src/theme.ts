/**
 * 主题令牌（REQ-009 9-A/9-D）：THEMES 由 packages/design-tokens 生成，勿手改——
 * 与 web globals.css / miniapp app.scss 同源。本模块是移动端唯一取用点：
 * 组件一律 useTheme() 取当前深浅色令牌，勿再散写 THEMES[scheme === ...]。
 */
import { useColorScheme } from "react-native";
import { THEMES, type MobileTheme as Theme } from "@shiguangri/design-tokens/generated/mobile-themes";

export { THEMES };
export type { Theme };

/** 系统深浅色 → 当前主题（非 light 一律回退 dark，与拆分前行为一致） */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return THEMES[scheme === "light" ? "light" : "dark"];
}
