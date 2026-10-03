/**
 * 推送通道（REQ-009 9-D）——代码就绪，真机验证留给后续 EAS 构建：
 * - ⚠ iOS：需要 aps-environment entitlement（EAS credentials 配 APNs key；Expo Go 收不到真推送）。
 * - ⚠ Android 13+：POST_NOTIFICATIONS 运行时权限由 requestPermissionsAsync 统一申请；
 *   FCM v1 凭据（google-services.json）需随 EAS 构建注入，本地 dev build 无凭据时取 token 会抛错。
 * - token：getExpoPushTokenAsync 内部先 getDevicePushTokenAsync（Android 走 FCM v1 / iOS 走 APNs），
 *   再向 Expo 服务器换取 ExponentPushToken。服务端走 exp.host 推送只认这种令牌
 *   （原生 FCM/APNs token 需 Firebase Admin SDK 下发，不在本批范围）。
 * - 开关默认关闭（SecureStore 持久化）：动态屏顶栏 🔔 开启 → 注册；App 启动且开关开着 → 静默补注册
 *   （顺带刷新服务端 device_tokens.last_seen_at）。
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiDelete, apiPost } from "./api";

const TOGGLE_KEY = "shiguang_push_enabled";
const TOKEN_KEY = "shiguang_push_token";

/** 推送开关（SecureStore 持久化；读失败按关闭处理——模拟器缺 Keychain 等场景） */
export async function getPushEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(TOGGLE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setPushEnabled(on: boolean): Promise<void> {
  try {
    if (on) await SecureStore.setItemAsync(TOGGLE_KEY, "1");
    else await SecureStore.deleteItemAsync(TOGGLE_KEY);
  } catch {
    // 忽略存储异常：开关只是会话级生效
  }
}

async function cachedToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 换取 ExponentPushToken（projectId 来自 app.json extra.eas.projectId，经 expo-constants 读配置） */
async function fetchExpoPushToken(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : {},
  );
  return data;
}

/**
 * 注册推送：权限（iOS 弹窗 / Android 13+ POST_NOTIFICATIONS）→ ExpoPushToken → POST /api/devices。
 * 失败不抛出，返回原因供开关 UI 提示。
 */
export async function registerPush(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return { ok: false, reason: "未授予通知权限" };
    const token = await fetchExpoPushToken();
    await apiPost("/api/devices", { platform: Platform.OS === "ios" ? "ios" : "android", token });
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch {
      // 缓存失败只影响后续注销粒度（注销会退化为删除本人全部 token）
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "推送注册失败" };
  }
}

/** 注销：DELETE /api/devices（带缓存 token；无缓存则删本人全部）+ 清本地缓存。网络失败不阻塞本地关闭 */
export async function unregisterPush(): Promise<void> {
  const token = await cachedToken();
  if (token) {
    try {
      await apiDelete("/api/devices", { token });
    } catch {
      // 服务端残留由 last_seen_at 陈旧判定兜底
    }
  }
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** App 启动且已登录时调用：开关开着 → 静默补注册（刷新 last_seen_at）；关着不动 */
export async function startupPushSync(): Promise<void> {
  if (!(await getPushEnabled())) return;
  await registerPush();
}
