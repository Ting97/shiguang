import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, StyleSheet, Text, TextInput, View,
  useColorScheme, useWindowDimensions,
} from "react-native";
import Animated, {
  Easing, FadeInDown, FadeOut, SlideInDown,
  useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence,
  withSpring, withTiming,
} from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { Audio } from "expo-av";
import { ApiError, getToken, loadFeed, loadTradingAccounts, loadTradingDaily, login, sendText, transcribe, type Moment } from "./src/api";

const C = {
  bg: "#020617", card: "#0f172a", line: "#1e293b",
  ink: "#f1f5f9", dim: "#94a3b8", accent: "#38bdf8",
  amber: "#f1c66b", danger: "#f43f5e", ok: "#34d399",
};

/** 长按起录的等待时长：松开早于它 = 点按打开文字面板 */
const LONG_PRESS_MS = 500;
/** 语音最长 30 秒（GLM-ASR 单文件限制 0–30s），29 秒自动停止留余量 */
const VOICE_MAX_SECONDS = 30;
const AUTO_STOP_MS = (VOICE_MAX_SECONDS - 1) * 1000;
/** 短于此时长视为误触，不送识别 */
const MIN_HOLD_MS = 600;
/** 按住时上滑超过该逻辑像素视为「取消」手势 */
const CANCEL_SLIDE_PX = 80;

/**
 * 主题令牌：与 Web 端 globals.css 的 :root（深色默认）/ [data-theme="light"] 完全同源。
 * 悬浮圆钮颜色按约定：夜间浅蓝 / 日间奶白。
 */
const THEMES = {
  dark: {
    bg: "#020617",
    surface: "#0f172a",
    surfaceSoft: "rgba(15, 23, 42, 0.72)",
    elevated: "#1e293b",
    glassBorder: "rgba(148, 163, 184, 0.16)",
    glassHighlight: "rgba(255, 255, 255, 0.06)",
    line: "#334155",
    lineSoft: "#1e293b",
    ink: "#f1f5f9",
    inkSoft: "#cbd5e1",
    inkMute: "#94a3b8",
    inkDim: "#64748b",
    inkFaint: "#475569",
    accent: "#7dd3fc",
    accentBright: "#0ea5e9",
    danger: "#fda4af",
    dangerSolid: "#f43f5e",
    success: "#6ee7b7",
    title: "#f8fafc",
    scrim: "rgba(2, 6, 23, 0.55)",
    fab: "#38bdf8",
    fabFg: "#062033",
    bannerOkBg: "rgba(16, 185, 129, 0.1)",
    bannerOkBorder: "rgba(16, 185, 129, 0.3)",
    bannerErrBg: "rgba(244, 63, 94, 0.1)",
    bannerErrBorder: "rgba(244, 63, 94, 0.3)",
    chipWarn: "#fcd34d",
    blurTint: "dark" as const,
    aurora: { sky: 0.16, indigo: 0.11, pink: 0.07 },
  },
  light: {
    bg: "#f1f5f9",
    surface: "#ffffff",
    surfaceSoft: "rgba(255, 255, 255, 0.78)",
    elevated: "#f1f5f9",
    glassBorder: "rgba(15, 23, 42, 0.08)",
    glassHighlight: "rgba(255, 255, 255, 0.65)",
    line: "#d3dbe4",
    lineSoft: "#e5eaf1",
    ink: "#0f172a",
    inkSoft: "#334155",
    inkMute: "#475569",
    inkDim: "#64748b",
    inkFaint: "#94a3b8",
    accent: "#0369a1",
    accentBright: "#0ea5e9",
    danger: "#be123c",
    dangerSolid: "#f43f5e",
    success: "#047857",
    title: "#0f172a",
    scrim: "rgba(100, 116, 139, 0.45)",
    fab: "#f7f1e3",
    fabFg: "#0f172a",
    bannerOkBg: "rgba(16, 185, 129, 0.1)",
    bannerOkBorder: "rgba(16, 185, 129, 0.3)",
    bannerErrBg: "rgba(244, 63, 94, 0.1)",
    bannerErrBorder: "rgba(244, 63, 94, 0.3)",
    chipWarn: "#b45309",
    blurTint: "light" as const,
    aurora: { sky: 0.12, indigo: 0.08, pink: 0.06 },
  },
} as const;

type Theme = {
  [K in keyof typeof THEMES.dark]: K extends "aurora"
    ? { sky: number; indigo: number; pink: number }
    : K extends "blurTint"
      ? "light" | "dark"
      : string;
};

/** 触觉兜底：模拟器/老设备可能不支持，失败静默 */
const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => {}),
  record: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  cancel: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  // 顶部「📝 动态 | 📈 交易」组件级切换（仿 Login/Home 先例）
  const [screen, setScreen] = useState<"feed" | "trades">("feed");

  useEffect(() => {
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

  if (!ready) {
    return <Center><ActivityIndicator color={THEMES.dark.accentBright} /></Center>;
  }
  return token ? (
    screen === "trades"
      ? <Trades onLogout={() => setTokenState(null)} onScreen={setScreen} />
      : <Home onLogout={() => setTokenState(null)} onScreen={setScreen} />
  ) : (
    <Login onOk={() => setTokenState("1")} />
  );
}

// —— 氛围组件 ——

/** 动态极光背景：三色径向光晕缓慢漂移 + 呼吸（Skia GPU 绘制，性能无忧） */
function AuroraBackground({ t }: { t: Theme }) {
  const { width: W, height: H } = useWindowDimensions();
  const r = Math.max(W, H) * 0.62;
  // 漂移与呼吸：各自独立的缓慢往复
  const p = useSharedValue(0);
  const breathe = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 22000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 22000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    breathe.value = withRepeat(
      withSequence(withTiming(1, { duration: 5000, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 5000, easing: Easing.inOut(Easing.quad) })),
      -1,
      false,
    );
  }, [p, breathe]);

  // Skia 属性动画必须经由 useDerivedValue 桥接 SharedValue
  const cx1 = useDerivedValue(() => W * (0.18 + 0.22 * p.value));
  const cy1 = useDerivedValue(() => H * (0.08 + 0.06 * (1 - p.value)));
  const cx2 = useDerivedValue(() => W * (0.95 - 0.18 * p.value));
  const cy2 = useDerivedValue(() => H * (0.38 + 0.05 * p.value));
  const cx3 = useDerivedValue(() => W * (0.25 + 0.1 * (1 - p.value)));
  const cy3 = useDerivedValue(() => H * (0.92 - 0.05 * p.value));
  const skyOp = useDerivedValue(() => t.aurora.sky * (0.75 + 0.25 * breathe.value));

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={cx1} cy={cy1} r={r} opacity={skyOp}>
        <RadialGradient c={vec(W * 0.3, H * 0.12)} r={r} colors={["#38bdf8", "rgba(56,189,248,0)"]} />
      </Circle>
      <Circle cx={cx2} cy={cy2} r={r * 0.85} opacity={t.aurora.indigo}>
        <RadialGradient c={vec(W * 0.9, H * 0.4)} r={r * 0.85} colors={["#818cf8", "rgba(129,140,248,0)"]} />
      </Circle>
      <Circle cx={cx3} cy={cy3} r={r * 0.8} opacity={t.aurora.pink}>
        <RadialGradient c={vec(W * 0.3, H * 0.9)} r={r * 0.8} colors={["#f472b6", "rgba(244,114,182,0)"]} />
      </Circle>
    </Canvas>
  );
}

/** 呼吸微光层（FAB 待机光晕） */
function BreathingGlow({ color }: { color: string }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withRepeat(
      withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.quad) })),
      -1,
      false,
    );
  }, [sv]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.18 + 0.16 * sv.value,
    transform: [{ scale: 1 + 0.12 * sv.value }],
  }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: 999 }, style]} />;
}

/** 录音脉冲扩散环 */
function PulseRing({ color, delay }: { color: string; delay: number }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [sv, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - sv.value),
    transform: [{ scale: 1 + 1.1 * sv.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: 999, borderWidth: 2, borderColor: color }, style]}
    />
  );
}

/** 录音声波条：错峰跳动的弹性竖条 */
function WaveBar({ index, color }: { index: number; color: string }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(
      index * 85,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 + index * 22, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 320 + index * 22, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [sv, index]);
  const style = useAnimatedStyle(() => ({ height: 10 + 30 * sv.value }));
  return <Animated.View style={[{ width: 5, borderRadius: 3, backgroundColor: color }, style]} />;
}

/** 骨架屏假卡片 */
function SkeletonCard({ t, delay }: { t: Theme; delay: number }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })),
        -1,
        false,
      ),
    );
  }, [sv, delay]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.3 * sv.value }));
  return (
    <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
      <View style={s.cardBody}>
        <View style={[s.avatar, { backgroundColor: t.elevated, borderColor: t.line }]} />
        <View style={{ flex: 1 }}>
          <View style={[s.skelLine, { backgroundColor: t.elevated, width: "30%" }]} />
          <Animated.View style={[s.skelLine, { backgroundColor: t.elevated, width: "88%", marginTop: 14 }, style]} />
          <Animated.View style={[s.skelLine, { backgroundColor: t.elevated, width: "62%", marginTop: 10 }, style]} />
        </View>
      </View>
    </View>
  );
}

// —— 登录（对齐 Web 登录页 + 极光氛围） ——

function Login({ onOk }: { onOk: () => void }) {
  const scheme = useColorScheme();
  const t = THEMES[scheme === "light" ? "light" : "dark"];
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

/** 玻璃输入框：聚焦光晕描边（accent 边框渐变过渡） */
function BlurInput({
  t, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, multiline,
}: {
  t: Theme; placeholder: string; value: string; onChangeText: (v: string) => void;
  secureTextEntry?: boolean; keyboardType?: "email-address"; autoCapitalize?: "none"; multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const style = useAnimatedStyle(() => ({
    borderColor: withTiming(focused ? t.accent : t.lineSoft, { duration: 180 }),
  }));
  return (
    <Animated.View style={[multiline ? s.inputWrapMultiline : s.inputWrap, { backgroundColor: t.surface }, style]}>
      <TextInput
        style={multiline ? [s.inputMultiline, { color: t.ink }] : [s.input, { color: t.ink }]}
        placeholder={placeholder} placeholderTextColor={t.inkFaint}
        value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize}
        multiline={multiline} maxLength={multiline ? 2000 : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      />
    </Animated.View>
  );
}

// —— 主界面：动态流 + 底部中央悬浮圆圈（点按=文字 / 长按=语音） ——

function Home({ onLogout, onScreen }: { onLogout: () => void; onScreen?: (s: "feed" | "trades") => void }) {
  const scheme = useColorScheme();
  const t = THEMES[scheme === "light" ? "light" : "dark"];
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recState, setRecState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 手势与录音的命令式状态（避免 setTimeout / 录音回调读到过期的 state）
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const longFired = useRef(false);
  const startY = useRef(0);
  const startAt = useRef(0);
  const autoStop = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  // FAB 按压弹性
  const fabScale = useSharedValue(1);

  const refresh = useCallback(async () => {
    try {
      setMoments(await loadFeed());
    } catch (e) {
      if (e instanceof Error && e.message.includes("401")) onLogout();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onLogout]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic.tap();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    return () => {
      clearTimers();
      const rec = recordingRef.current;
      if (rec) {
        recordingRef.current = null;
        rec.stopAndUnloadAsync().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t2 = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t2);
  }, [msg]);

  function clearTimers() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    if (autoStopTimer.current) clearTimeout(autoStopTimer.current);
    autoStopTimer.current = null;
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = null;
  }

  const send = async () => {
    const x = text.trim();
    if (!x || sending) return;
    setSending(true);
    try {
      await sendText(x);
      setText("");
      setSheetOpen(false);
      setMsg({ ok: true, text: "✅ 已记录，AI 识别中…" });
      haptic.success();
      setTimeout(refresh, 6000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "发送失败" });
    } finally {
      setSending(false);
    }
  };

  // —— 长按语音：起录 / 松手送识别 / 取消 ——

  async function startRec() {
    if (recordingRef.current) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setMsg({ ok: false, text: "未授予麦克风权限，无法语音输入" });
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      // Android：MediaRecorder 无 PCM 输出，DEFAULT(3gp/amr) GLM-ASR 不认；用 AAC/M4A（16kHz 单声道）
      const { recording: rec } = await Audio.Recording.createAsync({
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: ".wav",
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: "audio/wav",
          bitsPerSecond: 256000,
        },
      });
      recordingRef.current = rec;
      startAt.current = Date.now();
      autoStop.current = false;
      setSeconds(0);
      setCancelArmed(false);
      setRecState("recording");
      haptic.record();
      tickTimer.current = setInterval(() => setSeconds((x) => x + 1), 1000);
      autoStopTimer.current = setTimeout(() => {
        autoStop.current = true;
        void stopAndSend();
      }, AUTO_STOP_MS);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "无法开始录音" });
    }
  }

  /** 松手（或到 29 秒自动停）：停止录音 → ASR 转写 → 回填输入面板预览，确认后才发布 */
  async function stopAndSend() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    clearTimers();
    setRecState("transcribing");
    try {
      const heldMs = Date.now() - startAt.current;
      const wasAuto = autoStop.current;
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (heldMs < MIN_HOLD_MS) {
        setMsg({ ok: true, text: "没听到内容，请按住说话再松开" });
        return;
      }
      const uri = rec.getURI();
      if (!uri) throw new Error("录音不可用");
      const text = await transcribe(uri);
      if (!text) throw new Error("没有听清内容，请再试一次");
      setText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      setSheetOpen(true);
      haptic.tap();
      if (wasAuto) setMsg({ ok: true, text: `已录满 ${VOICE_MAX_SECONDS} 秒，自动识别完成` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "识别失败" });
    } finally {
      setRecState("idle");
      setSeconds(0);
      setCancelArmed(false);
      autoStop.current = false;
    }
  }

  /** 上滑取消 / 中断：丢弃录音，不送识别 */
  function discardRec() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    clearTimers();
    rec.stopAndUnloadAsync().catch(() => {});
    Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    setRecState("idle");
    setSeconds(0);
    setCancelArmed(false);
    autoStop.current = false;
    haptic.cancel();
    setMsg({ ok: true, text: "录音已取消" });
  }

  // 悬浮圆圈手势（Responder 系统，无第三方手势库）：
  // 按下 → 500ms 内松开 = 点按打开文字面板；超过 = 起录；按住上滑 = 取消；松手 = 送识别
  function onGrant(e: { nativeEvent: { pageY: number } }) {
    if (recState !== "idle") return;
    fabScale.value = withSpring(0.92, { damping: 14 });
    startY.current = e.nativeEvent.pageY;
    longFired.current = false;
    setCancelArmed(false);
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      void startRec();
    }, LONG_PRESS_MS);
  }

  function onMove(e: { nativeEvent: { pageY: number } }) {
    if (!longFired.current) return;
    const dy = startY.current - e.nativeEvent.pageY; // 上滑为正
    // 带迟滞：越过阈值进入取消态，滑回一半退出
    if (dy > CANCEL_SLIDE_PX) setCancelArmed(true);
    else if (dy < CANCEL_SLIDE_PX / 2) setCancelArmed(false);
  }

  function onRelease() {
    fabScale.value = withSpring(1, { damping: 12 });
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    // 注意：录音中 recState 已是 "recording"，这里不能按 recState 拦截（否则松手被吞）。
    // 到点自动结束后才松手的场景：recordingRef 已清空，stopAndSend/discardRec 内部自会空转。
    if (!longFired.current) {
      haptic.tap();
      setText("");
      setSheetOpen(true);
      return;
    }
    if (cancelArmed) discardRec();
    else void stopAndSend();
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const recording = recState === "recording";

  // 按天分组：列表里插入「— 今天 —」分隔头（与 Web 动态流一致）
  const listData = useMemo(() => {
    const items: Array<{ key: string; kind: "day"; label: string } | { key: string; kind: "m"; m: Moment }> = [];
    let lastDay = "";
    for (const m of moments) {
      const d = new Date(m.created_at);
      const today = new Date();
      const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const diff = Math.round((dayStart(today) - dayStart(d)) / 86400_000);
      const label = diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
      if (label !== lastDay) {
        lastDay = label;
        items.push({ key: `day-${label}`, kind: "day", label });
      }
      items.push({ key: m.id, kind: "m", m });
    }
    return items;
  }, [moments]);

  const fabScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: fabScale.value }] }));

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AuroraBackground t={t} />

      {/* 顶栏：真毛玻璃 pill（对齐 Web 玻璃导航） */}
      <BlurView
        intensity={scheme === "light" ? 70 : 55}
        tint={t.blurTint}
        experimentalBlurMethod="dimezisBlurView"
        style={[s.nav, { overflow: "hidden" }]}
      >
        <View style={[s.navInner, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
          <Text style={[s.navBrand, { color: t.title }]}>拾光</Text>
          {/* 「📝 动态 | 📈 交易」切换：当前屏高亮（交易入口，只读） */}
          <View style={s.navTabs}>
            <View style={[s.navChip, { backgroundColor: t.elevated }]}>
              <Text style={[s.navChipText, { color: t.inkSoft }]}>📝 动态</Text>
            </View>
            {onScreen && (
              <Pressable onPress={() => onScreen("trades")} hitSlop={6}>
                <View style={[s.navChip, { borderWidth: 1, borderColor: t.lineSoft }]}>
                  <Text style={[s.navChipText, { color: t.inkMute }]}>📈 交易</Text>
                </View>
              </Pressable>
            )}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={[s.navExit, { color: t.inkMute }]}>退出</Text>
          </Pressable>
        </View>
      </BlurView>

      <View style={s.head}>
        <Text style={[s.headTitle, { color: t.title }]}>
          拾光 <Text style={[s.headSub, { color: t.inkDim }]}>动态</Text>
        </Text>
        <Text style={[s.headDesc, { color: t.inkMute }]}>随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来 todo</Text>
      </View>

      {msg && (
        <Animated.View
          entering={SlideInDown.springify().damping(15)}
          exiting={FadeOut.duration(250)}
          style={[
            s.banner,
            msg.ok
              ? { backgroundColor: t.bannerOkBg, borderColor: t.bannerOkBorder }
              : { backgroundColor: t.bannerErrBg, borderColor: t.bannerErrBorder },
          ]}
        >
          <Text style={{ color: msg.ok ? t.success : t.danger, fontSize: 12, lineHeight: 18 }}>{msg.text}</Text>
        </Animated.View>
      )}

      {loading ? (
        <View style={s.list}>
          {[0, 140, 280].map((d) => (
            <SkeletonCard key={d} t={t} delay={d} />
          ))}
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(x) => x.key}
          contentContainerStyle={s.list}
          renderItem={({ item, index }) =>
            item.kind === "day" ? (
              <Text style={[s.dayHead, { color: t.inkDim }]}>— {item.label} —</Text>
            ) : (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 55).springify().damping(15)}>
                <MomentCard m={item.m} t={t} />
              </Animated.View>
            )
          }
          ListEmptyComponent={<Text style={[s.empty, { color: t.inkMute }]}>还没有动态，点下方圆圈说一句话开始 ✨</Text>}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.accentBright}
              colors={[t.accentBright]}
              progressBackgroundColor={t.surface}
            />
          }
        />
      )}

      {/* 录音/识别浮层：全屏暗幕 + 毛玻璃信息卡。pointerEvents=none 纯视觉，
          否则浮层插入手势中途会吃掉 FAB 的松手事件，导致录音停不下来 */}
      {recState !== "idle" && (
        <View style={[s.overlay, { backgroundColor: t.scrim }]} pointerEvents="none">
          <BlurView intensity={scheme === "light" ? 60 : 45} tint={t.blurTint} experimentalBlurMethod="dimezisBlurView" style={[s.overlayCardWrap, { overflow: "hidden", borderRadius: 20 }]}>
            <View style={[s.overlayCard, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
              {recording ? (
                <>
                  <View style={s.recRow}>
                    <View style={[s.recDot, { backgroundColor: t.dangerSolid }]} />
                    <Text style={[s.recTime, { color: t.dangerSolid }]}>{mmss}</Text>
                  </View>
                  <View style={s.waveRow}>
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <WaveBar key={i} index={i} color={cancelArmed ? t.dangerSolid : t.accent} />
                    ))}
                  </View>
                  <Text style={[s.overlayHint, { color: cancelArmed ? t.dangerSolid : t.inkMute }]}>
                    {cancelArmed ? "↑ 松开取消" : `松开识别文字 · 上滑取消（最长 ${VOICE_MAX_SECONDS} 秒）`}
                  </Text>
                </>
              ) : (
                <>
                  <ActivityIndicator color={t.accentBright} />
                  <Text style={[s.overlayHint, { color: t.inkMute }]}>识别中…</Text>
                </>
              )}
            </View>
          </BlurView>
        </View>
      )}

      {/* 底部中央悬浮圆圈：点按=文字，长按=语音（夜间浅蓝 / 日间奶白）+ 呼吸微光 + 录音脉冲环 */}
      <View style={s.fabWrap} pointerEvents="box-none">
        <View style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center" }}>
          {recording && (
            <>
              <PulseRing color={t.dangerSolid} delay={0} />
              <PulseRing color={t.dangerSolid} delay={700} />
            </>
          )}
          <Animated.View style={[s.fabGlowWrap, fabScaleStyle]}>
            {!recording && recState === "idle" && <BreathingGlow color={t.fab} />}
            <View
              style={[s.fab, { backgroundColor: recording ? t.dangerSolid : t.fab }, recState === "transcribing" && { opacity: 0.7 }]}
              onStartShouldSetResponder={() => recState === "idle"}
              onResponderGrant={onGrant}
              onResponderMove={onMove}
              onResponderRelease={onRelease}
              onResponderTerminate={discardRec}
            >
              {recState === "transcribing" ? (
                <ActivityIndicator color={t.fabFg} size="small" />
              ) : (
                <Text style={[s.fabIcon, { color: t.fabFg }]}>🎙</Text>
              )}
            </View>
          </Animated.View>
        </View>
      </View>

      {/* 文字输入面板：点按=空面板；语音转写结果回填预览，确认后才发布 */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <KeyboardAvoidingView style={s.sheetWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <BlurView intensity={scheme === "light" ? 50 : 40} tint={t.blurTint} experimentalBlurMethod="dimezisBlurView" style={s.sheetBackdrop}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} />
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} />
          </BlurView>
          <View style={[s.sheet, { backgroundColor: t.surface, borderTopColor: t.glassBorder }]}>
            <View style={s.sheetHead}>
              <Text style={[s.sheetTitle, { color: t.inkSoft }]}>记录此刻</Text>
              <Pressable onPress={() => setSheetOpen(false)} hitSlop={10}>
                <Text style={[s.sheetClose, { color: t.inkDim }]}>✕</Text>
              </Pressable>
            </View>
            <BlurInput
              t={t} placeholder="说点什么…（试试“刚跑完步40分钟，心情不错”）"
              value={text} onChangeText={setText} multiline
            />
            <View style={s.sheetFoot}>
              <Text style={[s.sheetHint, { color: t.inkFaint }]}>发布后 AI 自动识别日程 / todo / 收支 / 心情</Text>
              <Pressable
                style={[s.gradBtnWrapSheet, (!text.trim() || sending) && { opacity: 0.45 }]}
                onPress={send} disabled={!text.trim() || sending}
              >
                <LinearGradient colors={["#0ea5e9", "#6366f1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradBtnSheet}>
                  {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={s.gradBtnText}>发布</Text>}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// —— 交易（REQ-005 FR-1.8 只读屏：账号汇总 + 近 30 日每日盈亏 + 权益累计曲线；无任何写/导入口） ——

function Trades({ onLogout, onScreen }: { onLogout: () => void; onScreen: (s: "feed" | "trades") => void }) {
  const scheme = useColorScheme();
  const t = THEMES[scheme === "light" ? "light" : "dark"];
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  /** 401 与现有 apiGet 错误路径一致地退出登录；其余展示错误文案 */
  const onFail = useCallback((e: unknown) => {
    if ((e instanceof ApiError && e.status === 401) || (e instanceof Error && e.message.includes("401"))) {
      onLogout();
      return;
    }
    setErr(e instanceof Error ? e.message : "加载失败");
  }, [onLogout]);

  const loadAccounts = useCallback(async () => {
    try {
      const j: any = await loadTradingAccounts();
      const list: any[] = j?.accounts ?? [];
      setAccounts(list);
      setAccountId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0]?.id ?? null));
      setErr(null);
    } catch (e) {
      onFail(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onFail]);

  const loadDaily = useCallback(async () => {
    if (!accountId) {
      setDays([]);
      setRefreshing(false);
      return;
    }
    try {
      const j: any = await loadTradingDaily(accountId, 30);
      setDays(j?.days ?? []);
      setErr(null);
    } catch (e) {
      onFail(e);
    } finally {
      setRefreshing(false);
    }
  }, [accountId, onFail]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadDaily();
  }, [loadDaily]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic.tap();
    await Promise.all([loadAccounts(), loadDaily()]);
  }, [loadAccounts, loadDaily]);

  /** USD 金额：负数带 - 号，`$` 前缀 */
  const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Number(v) || 0).toFixed(2)}`;

  // 权益累计：按服务端升序 ymd 累加 net，柱高在 [min,max] 间归一（View 柱状近似曲线）
  const curve = useMemo(() => {
    let acc = 0;
    const pts = days.map((d) => (acc += Number(d.net) || 0));
    const max = Math.max(...pts, 0);
    const min = Math.min(...pts, 0);
    const range = max - min || 1;
    return pts.map((v) => ({ v, h: 6 + ((v - min) / range) * 46 }));
  }, [days]);
  const curveTotal = curve.length > 0 ? curve[curve.length - 1].v : 0;
  const firstYmd = days[0]?.ymd;
  const lastYmd = days[days.length - 1]?.ymd;

  // 每日列表：最新在前
  const listDays = useMemo(() => [...days].sort((a, b) => (a.ymd < b.ymd ? 1 : -1)), [days]);

  const net = Number(account?.netProfit ?? 0);
  const name = account?.nickname || account?.login || "";

  const header = (
    <>
      {accounts.length > 1 && (
        <View style={s.acctWrap}>
          {accounts.map((a) => {
            const on = a.id === accountId;
            return (
              <Pressable key={a.id} onPress={() => { haptic.tap(); setAccountId(a.id); }} hitSlop={4}>
                <View style={[s.acctChip, { borderColor: on ? t.accent : t.lineSoft, backgroundColor: on ? t.bg : "transparent" }]}>
                  <Text style={[s.acctChipText, { color: on ? t.accent : t.inkMute }]} numberOfLines={1}>
                    {a.nickname || a.login}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 账号汇总卡 */}
      {account && (
        <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
          <LinearGradient
            colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
            style={s.cardHighlight}
            pointerEvents="none"
          />
          <View style={s.sumHead}>
            <Text style={[s.sumLabel, { color: t.inkMute }]}>总净盈亏</Text>
            {name ? <Text style={[s.sumName, { color: t.inkDim }]} numberOfLines={1}>{name}</Text> : null}
          </View>
          <Text style={[s.sumNet, { color: net >= 0 ? t.success : t.danger }]}>{usd(net)}</Text>
          <View style={s.sumRow}>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{account.winRate == null ? "—" : `${account.winRate}%`}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>胜率</Text>
            </View>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{Number(account.trades) || 0}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>笔数</Text>
            </View>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{(Number(account.lots) || 0).toFixed(2)}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>手数</Text>
            </View>
          </View>
        </View>
      )}

      {/* 权益累计曲线（近 30 日）：View 柱状近似，绿涨红跌 */}
      <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
        <View style={s.chartHead}>
          <Text style={[s.sectionTitle, { color: t.inkSoft }]}>📈 权益累计（近 30 日）</Text>
          {days.length > 0 && (
            <Text style={[s.chartTotal, { color: curveTotal >= 0 ? t.success : t.danger }]}>{usd(curveTotal)}</Text>
          )}
        </View>
        {days.length === 0 ? (
          <Text style={[s.chartEmpty, { color: t.inkMute }]}>近 30 日暂无交易</Text>
        ) : (
          <>
            <View style={[s.chartBars, { borderBottomColor: t.lineSoft }]}>
              {curve.map((p, i) => (
                <View key={i} style={[s.chartBar, { height: p.h, backgroundColor: p.v >= 0 ? t.success : t.danger, opacity: 0.85 }]} />
              ))}
            </View>
            <View style={s.chartLabels}>
              <Text style={[s.chartLabel, { color: t.inkDim }]}>{firstYmd?.slice(5)}</Text>
              <Text style={[s.chartLabel, { color: t.inkDim }]}>{lastYmd?.slice(5)}</Text>
            </View>
          </>
        )}
      </View>

      <Text style={[s.sectionTitle2, { color: t.inkDim }]}>近 30 日每日盈亏</Text>
    </>
  );

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AuroraBackground t={t} />

      {/* 顶栏：与 Home 同款毛玻璃 pill，「📝 动态 | 📈 交易」切换 */}
      <BlurView
        intensity={scheme === "light" ? 70 : 55}
        tint={t.blurTint}
        experimentalBlurMethod="dimezisBlurView"
        style={[s.nav, { overflow: "hidden" }]}
      >
        <View style={[s.navInner, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
          <Text style={[s.navBrand, { color: t.title }]}>拾光</Text>
          <View style={s.navTabs}>
            <Pressable onPress={() => onScreen("feed")} hitSlop={6}>
              <View style={[s.navChip, { borderWidth: 1, borderColor: t.lineSoft }]}>
                <Text style={[s.navChipText, { color: t.inkMute }]}>📝 动态</Text>
              </View>
            </Pressable>
            <View style={[s.navChip, { backgroundColor: t.elevated }]}>
              <Text style={[s.navChipText, { color: t.inkSoft }]}>📈 交易</Text>
            </View>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={[s.navExit, { color: t.inkMute }]}>退出</Text>
          </Pressable>
        </View>
      </BlurView>

      <View style={s.head}>
        <Text style={[s.headTitle, { color: t.title }]}>
          拾光 <Text style={[s.headSub, { color: t.inkDim }]}>交易</Text>
        </Text>
        <Text style={[s.headDesc, { color: t.inkMute }]}>只读概览：账号汇总 · 每日盈亏 · 权益累计（数据来自网页端导入）</Text>
      </View>

      {err && (
        <View style={[s.banner, { backgroundColor: t.bannerErrBg, borderColor: t.bannerErrBorder }]}>
          <Text style={{ color: t.danger, fontSize: 12, lineHeight: 18 }}>{err}</Text>
        </View>
      )}

      {loading ? (
        <View style={s.list}>
          {[0, 140, 280].map((d) => (
            <SkeletonCard key={d} t={t} delay={d} />
          ))}
        </View>
      ) : accounts.length === 0 ? (
        <Text style={[s.empty, { color: t.inkMute }]}>还没有交易账号，请先在网页端导入（此处只读）</Text>
      ) : (
        <FlatList
          data={listDays}
          keyExtractor={(d, i) => String(d.ymd ?? i)}
          contentContainerStyle={s.list}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={[s.empty, { color: t.inkMute }]}>近 30 日暂无交易记录</Text>}
          renderItem={({ item }) => (
            <View style={[s.dayRow, { borderBottomColor: t.lineSoft }]}>
              <Text style={[s.dayDate, { color: t.inkSoft }]}>{String(item.ymd ?? "").slice(5)}</Text>
              <Text style={[s.dayCount, { color: t.inkDim }]}>{Number(item.count) || 0} 笔</Text>
              <Text style={[s.dayNet, { color: Number(item.net) >= 0 ? t.success : t.danger }]}>{usd(Number(item.net))}</Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.accentBright}
              colors={[t.accentBright]}
              progressBackgroundColor={t.surface}
            />
          }
        />
      )}
    </View>
  );
}

/** 动态卡片：结构/样式对齐 Web moment-feed 的玻璃卡片（头像圈 + 意图标签 + 原文 + 收益标签） */
function MomentCard({ m, t }: { m: Moment; t: Theme }) {
  const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  const time = new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
      {/* 顶部高光描边：玻璃卡片的受光面 */}
      <LinearGradient
        colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={s.cardHighlight}
        pointerEvents="none"
      />
      <View style={s.cardBody}>
        {/* 头像位：心情 emoji（无心情用 📝），对齐 Web 的 40px 圆圈 */}
        <View style={[s.avatar, { backgroundColor: t.elevated, borderColor: t.line }]}>
          <Text style={s.avatarIcon}>{m.mood ? "😊" : "📝"}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.cardHead}>
            <View style={[s.cardTag, { backgroundColor: t.elevated }]}>
              <Text style={[s.cardTagText, { color: t.inkMute }]}>📝 动态</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={[s.cardTime, { color: t.inkDim }]}>{time}</Text>
          </View>
          <Text style={[s.cardText, { color: t.ink }]}>{m.raw_text}</Text>
          {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0) && (
            <View style={s.chips}>
              {m.blocks.length > 0 && (
                <Text style={[s.chip, { color: t.accent, borderColor: t.lineSoft, backgroundColor: t.bg }]}>
                  🕒 {m.blocks.length} 日程
                </Text>
              )}
              {m.todos.length > 0 && (
                <Text style={[s.chip, { color: t.accent, borderColor: t.lineSoft, backgroundColor: t.bg }]}>
                  📋 {m.todos.length} todo
                </Text>
              )}
              {m.transactions.map((tx) => (
                <Text
                  key={tx.id}
                  style={[s.chip, { color: tx.direction === "in" ? t.success : t.chipWarn, borderColor: t.lineSoft, backgroundColor: t.bg }]}
                >
                  💰 {tx.direction === "in" ? "+" : "-"}{yuan(tx.amount_cents)}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function Center({ children, bg }: { children: React.ReactNode; bg?: string }) {
  return <View style={[s.root, s.center, bg ? { backgroundColor: bg } : null]}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // 登录
  logo: { fontSize: 56, textAlign: "center" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginTop: 8 },
  sub: { fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 28 },
  inputWrap: {
    borderWidth: 1, borderRadius: 12,
    marginBottom: 12, width: 280,
  },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputWrapMultiline: {
    borderWidth: 1, borderRadius: 12,
  },
  inputMultiline: {
    minHeight: 90, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, textAlignVertical: "top",
  },
  err: { fontSize: 12, marginBottom: 10 },
  gradBtnWrap: { width: 280, borderRadius: 12, overflow: "hidden" },
  gradBtn: { paddingVertical: 12, paddingHorizontal: 32, alignItems: "center", borderRadius: 12 },
  gradBtnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  hint: { fontSize: 11, marginTop: 18, textAlign: "center" },
  // 顶栏（毛玻璃 pill）
  nav: { borderRadius: 999, marginHorizontal: 12, marginTop: 10, marginBottom: 4 },
  navInner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  navBrand: { fontSize: 15, fontWeight: "700" },
  navChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  navChipText: { fontSize: 12 },
  navExit: { fontSize: 13 },
  head: { alignItems: "center", marginTop: 14, marginBottom: 12, paddingHorizontal: 16 },
  headTitle: { fontSize: 28, fontWeight: "700", letterSpacing: 2 },
  headSub: { fontSize: 14, fontWeight: "400", letterSpacing: 0 },
  headDesc: { fontSize: 12, marginTop: 6, textAlign: "center" },
  // 横幅（msg-banner）
  banner: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
    marginHorizontal: 16, marginBottom: 8,
  },
  // 动态流
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  dayHead: { fontSize: 12, textAlign: "center", marginVertical: 10 },
  empty: { textAlign: "center", marginTop: 60 },
  card: {
    borderWidth: 1, borderRadius: 16,
    padding: 14, marginBottom: 10, overflow: "hidden",
  },
  cardHighlight: { position: "absolute", left: 0, right: 0, top: 0, height: 60 },
  cardBody: { flexDirection: "row", gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  avatarIcon: { fontSize: 18 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  cardTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  cardTagText: { fontSize: 10 },
  cardTime: { fontSize: 11 },
  cardText: { fontSize: 15, lineHeight: 22, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, overflow: "hidden",
  },
  skelLine: { height: 14, borderRadius: 7 },
  // 底部中央悬浮圆圈
  fabWrap: {
    position: "absolute", bottom: 14, left: 0, right: 0,
    alignItems: "center",
  },
  fabGlowWrap: { width: 64, height: 64, borderRadius: 32 },
  fab: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35,
    shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 26 },
  // 录音/识别浮层
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
  },
  overlayCardWrap: { minWidth: 250 },
  overlayCard: {
    borderWidth: 1,
    paddingHorizontal: 28, paddingVertical: 22, alignItems: "center", gap: 12,
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot: { width: 12, height: 12, borderRadius: 6 },
  recTime: { fontSize: 30, fontWeight: "700", fontVariant: ["tabular-nums"] },
  waveRow: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 42 },
  overlayHint: { fontSize: 12, textAlign: "center" },
  // 底部输入面板
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, paddingBottom: 28,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sheetTitle: { fontSize: 15, fontWeight: "600" },
  sheetClose: { fontSize: 16, paddingHorizontal: 4 },
  sheetFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  sheetHint: { fontSize: 11, flex: 1, marginRight: 10 },
  gradBtnWrapSheet: { borderRadius: 12, overflow: "hidden" },
  gradBtnSheet: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, alignItems: "center" },
  // 顶栏「动态 | 交易」切换 chip 组
  navTabs: { flexDirection: "row", alignItems: "center", gap: 6 },
  // 交易屏（Trades 只读）
  acctWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  acctChip: { maxWidth: 160, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  acctChipText: { fontSize: 12 },
  sumHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sumLabel: { fontSize: 12 },
  sumName: { fontSize: 12, flexShrink: 1 },
  sumNet: { fontSize: 30, fontWeight: "700", marginTop: 4, fontVariant: ["tabular-nums"] },
  sumRow: { flexDirection: "row", marginTop: 12 },
  sumItem: { flex: 1, alignItems: "center", gap: 2 },
  sumItemNum: { fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  sumItemLabel: { fontSize: 11 },
  chartHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chartTotal: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chartBars: {
    flexDirection: "row", alignItems: "flex-end", gap: 2,
    height: 52, marginTop: 12, borderBottomWidth: 1,
  },
  chartBar: { flex: 1, borderRadius: 2 },
  chartLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  chartLabel: { fontSize: 10, fontVariant: ["tabular-nums"] },
  chartEmpty: { fontSize: 12, textAlign: "center", paddingVertical: 24 },
  sectionTitle: { fontSize: 13, fontWeight: "600" },
  sectionTitle2: { fontSize: 12, marginTop: 16, marginBottom: 8, letterSpacing: 1 },
  dayRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  dayDate: { width: 56, fontSize: 13, fontVariant: ["tabular-nums"] },
  dayCount: { fontSize: 12, flex: 1 },
  dayNet: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
