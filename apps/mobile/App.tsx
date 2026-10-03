/**
 * 拾光移动端（Expo）入口（REQ-009 9-D 拆分为薄壳）：
 * 只负责 会话恢复 / 三屏切换（登录 → 动态 | 交易）；UI 在 src/screens，通用件在 src/components。
 */
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { THEMES } from "./src/theme";
import { getToken } from "./src/api";
import { initOta } from "./src/ota";
import { startupPushSync } from "./src/push";
import Center from "./src/components/Center";
import LoginScreen from "./src/screens/LoginScreen";
import FeedScreen from "./src/screens/FeedScreen";
import TradesScreen from "./src/screens/TradesScreen";

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  // 顶部「📝 动态 | 📈 交易」组件级切换（仿 Login/Home 先例）
  const [screen, setScreen] = useState<"feed" | "trades">("feed");

  useEffect(() => {
    // OTA 热更新（REQ-009 9-D）：启动 + 回前台节流检查；dev/模拟器内部静默跳过
    initOta();
    (async () => {
      // E2E 测试钩子：EXPO_PUBLIC_E2E_AUTOLOGIN=1 跳过登录页（仅 AUTH_DISABLED 本地服务可用）
      if (process.env.EXPO_PUBLIC_E2E_AUTOLOGIN === "1") {
        setTokenState("e2e");
        setReady(true);
        return;
      }
      setTokenState(await getToken());
      setReady(true);
    })();
  }, []);

  // 推送通道（REQ-009 9-D）：已登录时按开关静默补注册（默认关，未开启不动）
  useEffect(() => {
    if (token) void startupPushSync();
  }, [token]);

  if (!ready) {
    return <Center><ActivityIndicator color={THEMES.dark.accentBright} /></Center>;
  }
  return token ? (
    screen === "trades"
      ? <TradesScreen onLogout={() => setTokenState(null)} onScreen={setScreen} />
      : <FeedScreen onLogout={() => setTokenState(null)} onScreen={setScreen} />
  ) : (
    <LoginScreen onOk={() => setTokenState("1")} />
  );
}
