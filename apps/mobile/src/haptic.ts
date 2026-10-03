/**
 * 触觉反馈（REQ-009 9-D 拆分自 App.tsx）：模拟器/老设备可能不支持，失败静默。
 */
import * as Haptics from "expo-haptics";

export const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => {}),
  record: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  cancel: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
};
