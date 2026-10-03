/**
 * 推送开关（REQ-009 9-D）：动态屏顶栏 🔔/🔕，SecureStore 持久化，默认关。
 * 开启：请求权限并注册 token 到 /api/devices（失败 Alert 原因）；关闭：注销。
 * 真机推送链路（entitlement / FCM 凭据）待 EAS 构建，见 src/push.ts 顶部说明。
 */
import { useEffect, useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { getPushEnabled, registerPush, setPushEnabled, unregisterPush } from "../push";
import { haptic } from "../haptic";

export default function PushToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushEnabled().then(setOn);
  }, []);

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    haptic.tap();
    try {
      if (on) {
        await unregisterPush();
        await setPushEnabled(false);
        setOn(false);
      } else {
        const r = await registerPush();
        if (r.ok) {
          await setPushEnabled(true);
          setOn(true);
        } else {
          Alert.alert("推送未开启", r.reason ?? "请稍后再试");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable onPress={flip} disabled={busy} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Text style={{ fontSize: 13, opacity: busy ? 0.5 : 1 }}>{on ? "🔔" : "🔕"}</Text>
    </Pressable>
  );
}
