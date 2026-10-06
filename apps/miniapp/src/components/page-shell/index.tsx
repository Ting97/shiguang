/**
 * 页面壳：主题根容器(.app-bg + 可选 .theme-light) + 内容容器 + 底部标签栏。
 * 所有主框架页用它包一层（登录/绑定页除外，= web NAVLESS_PATHS）。
 * REQ-009 9-C：内挂 <ToastHost/>（= web providers 的 ToastHost 全局挂载）——
 * 各页操作反馈统一走底部 toast，不再各自维护 msg-banner 状态。
 */
import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useMemo, type ReactNode } from "react";
import NavBar, { type NavKey } from "../nav-bar";
import { ToastHost } from "../toast";
import { syncNativeBackground, useTheme } from "../../lib/theme";
import "./index.scss";

export default function PageShell({ active, children }: { active?: NavKey; children: ReactNode }) {
  const { theme } = useTheme();
  // 顶栏移除后内容直接从状态栏下开始：按机型注入状态栏高度（NAVLESS 页各自处理）
  const topPadPx = useMemo(() => {
    try {
      return Taro.getWindowInfo().statusBarHeight || 20;
    } catch {
      return 20;
    }
  }, []);
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  return (
    <View className={`app-bg${theme === "light" ? " theme-light" : ""}`}>
      <View className="page-body" style={{ paddingTop: `${topPadPx + 16}px` }}>
        {children}
      </View>
      {/* 底部标签栏：fixed 吸底（.page-body 底部已留避让），渲染顺序在内容之后 */}
      <NavBar active={active} />
      <ToastHost />
    </View>
  );
}
