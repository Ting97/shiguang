import { PropsWithChildren } from "react";
import Taro, { useLaunch } from "@tarojs/taro";
import { ensureSessionToken } from "./lib/session";
import { applySysTheme, getThemeMode, resolveTheme, syncNativeBackground } from "./lib/theme";

import "./app.scss";

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 启动即恢复本地会话 token（登录态由各页 request 401 兜底收敛到登录页）
    ensureSessionToken();
    // 原生页面底色跟随主题（web 端由 body 背景承担，小程序 page 元素需要 API 同步）
    syncNativeBackground(resolveTheme(getThemeMode()));
    // 跟随微信系统深浅色切换（system 模式此前只在启动读一次，切系统主题页面不跟随）：
    // 部分平台无此 API，先判存在；theme 运行时归一到 light/dark（applySysTheme 内不再兜底）
    if (Taro.onThemeChange) {
      Taro.onThemeChange(({ theme }) => applySysTheme(theme === "light" ? "light" : "dark"));
    }
  });
  return children;
}

export default App;
