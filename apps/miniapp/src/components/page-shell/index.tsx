/**
 * 页面壳：主题根容器(.app-bg + 可选 .theme-light) + 顶部导航 + 内容容器。
 * 所有主框架页用它包一层（登录/绑定页除外，= web NAVLESS_PATHS）。
 * REQ-009 9-C：内挂 <ToastHost/>（= web providers 的 ToastHost 全局挂载）——
 * 各页操作反馈统一走底部 toast，不再各自维护 msg-banner 状态。
 */
import { View } from "@tarojs/components";
import { useEffect, type ReactNode } from "react";
import NavBar, { type NavKey } from "../nav-bar";
import { ToastHost } from "../toast";
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
      <ToastHost />
    </View>
  );
}
