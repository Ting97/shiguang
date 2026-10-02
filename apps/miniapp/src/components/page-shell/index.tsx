/**
 * 页面壳：主题根容器(.app-bg + 可选 .theme-light) + 顶部导航 + 内容容器。
 * 所有主框架页用它包一层（登录/绑定页除外，= web NAVLESS_PATHS）。
 */
import { View } from "@tarojs/components";
import { useEffect, type ReactNode } from "react";
import NavBar, { type NavKey } from "../nav-bar";
import { syncNativeBackground, useTheme } from "../../lib/theme";
import "./index.scss";

export default function PageShell({ active, children }: { active?: NavKey; children: ReactNode }) {
  const { theme } = useTheme();
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  return (
    <View className={`app-bg${theme === "light" ? " theme-light" : ""}`}>
      <NavBar active={active} />
      <View className="page-body">{children}</View>
    </View>
  );
}
