/**
 * OTA 热更新（REQ-009 9-D）：expo-updates ~0.28 已装且 app.json 已配 updates.url + runtimeVersion
 * （policy appVersion），此前 0 处调用——现在真正启用。
 *
 * 策略：启动 + AppState 回前台时检查（同一实例节流 ≥4 小时）；有更新 → 下载完成后
 * Alert 提示「重启应用以更新」，用户确认后 reloadAsync。检查/下载/重启任何一步失败都静默
 * （热更是增强路径，绝不阻塞主流程）。dev / Expo Go / 模拟器（Updates.isEnabled=false）整体跳过。
 *
 * API 说明：expo-updates 0.28 的下载方法是 fetchUpdateAsync（旧名 downloadAsync 已移除）。
 */
import { Alert, AppState } from "react-native";
import * as Updates from "expo-updates";

/** 同一运行会话内两次检查的最小间隔：≥4 小时（前台切换频繁时避免打爆 EAS Update） */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let lastCheckAt = 0;
let inFlight = false;

async function checkAndOffer(): Promise<void> {
  if (!Updates.isEnabled || inFlight) return;
  inFlight = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) {
      // 与当前运行的更新相同（正常情况：下次冷启动自动生效），不打扰用户
      return;
    }
    Alert.alert("发现新版本", "更新已下载完成，重启应用以完成更新。", [
      { text: "稍后", style: "cancel" },
      {
        text: "立即重启",
        style: "default",
        onPress: () => {
          void Updates.reloadAsync().catch(() => {});
        },
      },
    ]);
  } catch {
    // 静默：无网/服务端不可达等均不提示
  } finally {
    inFlight = false;
  }
}

function throttledCheck(): void {
  if (Date.now() - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = Date.now();
  void checkAndOffer();
}

/** App 入口挂载：启动查一次 + 回前台节流再查。无 Updates 运行时（dev/模拟器）内部静默跳过 */
export function initOta(): void {
  if (!Updates.isEnabled) return;
  throttledCheck();
  AppState.addEventListener("change", (state) => {
    if (state === "active") throttledCheck();
  });
}
