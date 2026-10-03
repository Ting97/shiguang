/**
 * 登录屏（REQ-009 9-D 拆分自 App.tsx）：对齐 Web 登录页 + 极光氛围。
 */
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, useColorScheme } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { login } from "../api";
import { s } from "../styles";
import AuroraBackground from "../components/AuroraBackground";
import BlurInput from "../components/BlurInput";

export default function LoginScreen({ onOk }: { onOk: () => void }) {
  const scheme = useColorScheme();
  const t = useTheme();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await login(phone.trim(), password);
      onOk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: t.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AuroraBackground t={t} />
      <Animated.View entering={FadeInDown.springify().damping(16)} style={s.center}>
        <Text style={s.logo}>☀️</Text>
        <Text style={[s.title, { color: t.title }]}>拾光</Text>
        <Text style={[s.sub, { color: t.inkMute }]}>钱 · 时间 · 人，一句话记下来</Text>
        <BlurInput
          t={t} placeholder="手机号 / 邮箱" value={phone} onChangeText={setPhone}
          keyboardType="email-address" autoCapitalize="none"
        />
        <BlurInput t={t} placeholder="密码" value={password} onChangeText={setPassword} secureTextEntry />
        {err && <Text style={[s.err, { color: t.danger }]}>{err}</Text>}
        <Pressable onPress={submit} disabled={busy} style={[s.gradBtnWrap, busy && { opacity: 0.6 }]}>
          <LinearGradient colors={["#0ea5e9", "#6366f1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradBtn}>
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={s.gradBtnText}>登录</Text>}
          </LinearGradient>
        </Pressable>
        <Text style={[s.hint, { color: t.inkFaint }]}>短信验证码登录请使用网页版 · 注册需邀请码</Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
