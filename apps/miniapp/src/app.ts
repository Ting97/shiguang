import { PropsWithChildren } from "react";
import { useLaunch } from "@tarojs/taro";
import { ensureSessionToken } from "./lib/session";
import { getThemeMode, resolveTheme, syncNativeBackground } from "./lib/theme";

import "./app.scss";

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 启动即恢复本地会话 token（登录态由各页 request 401 兜底收敛到登录页）
    ensureSessionToken();
    // 原生页面底色跟随主题（web 端由 body 背景承担，小程序 page 元素需要 API 同步）
    syncNativeBackground(resolveTheme(getThemeMode()));
  });
  return children;
}

export default App;
