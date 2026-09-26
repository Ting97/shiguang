import { PropsWithChildren } from "react";
import { useLaunch } from "@tarojs/taro";
import { ensureSessionToken } from "./lib/session";

import "./app.scss";

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 启动即恢复本地会话 token（登录态由各页 request 401 兜底收敛到登录页）
    ensureSessionToken();
  });
  return children;
}

export default App;
