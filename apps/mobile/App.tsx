import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View, useColorScheme,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import { getToken, loadFeed, login, sendText, transcribe, type Moment } from "./src/api";

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
 * 主题令牌：与 Web 端 globals.css 的 :root（深色默认）/ [data-theme="light"] 完全同源，
 * 保证 App 与移动端 Web 视觉一致。悬浮圆钮颜色按用户约定：夜间浅蓝 / 日间奶白。
 */
const THEMES = {
  dark: {
    bg: "#020617",
    surface: "#0f172a",
    surfaceSoft: "rgba(15, 23, 42, 0.88)", // 玻璃卡片（--glass-bg-mobile）
    elevated: "#1e293b",
    glassBorder: "rgba(148, 163, 184, 0.12)", // --glass-border
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
    title: "#f8fafc", // .text-gradient 起点（近似主色）
    scrim: "rgba(2, 6, 23, 0.6)",
    fab: "#38bdf8", // 夜间：浅蓝
    fabFg: "#062033",
    bannerOkBg: "rgba(16, 185, 129, 0.1)",
    bannerOkBorder: "rgba(16, 185, 129, 0.3)",
    bannerErrBg: "rgba(244, 63, 94, 0.1)",
    bannerErrBorder: "rgba(244, 63, 94, 0.3)",
    chipWarnBg: "rgba(245, 158, 11, 0.15)",
    chipWarn: "#fcd34d",
  },
  light: {
    bg: "#f1f5f9",
    surface: "#ffffff",
    surfaceSoft: "rgba(255, 255, 255, 0.95)", // --glass-bg-mobile（浅色）
    elevated: "#f1f5f9",
    glassBorder: "rgba(15, 23, 42, 0.08)",
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
    scrim: "rgba(100, 116, 139, 0.55)",
    fab: "#f7f1e3", // 日间：奶白
    fabFg: "#0f172a",
    bannerOkBg: "rgba(16, 185, 129, 0.1)",
    bannerOkBorder: "rgba(16, 185, 129, 0.3)",
    bannerErrBg: "rgba(244, 63, 94, 0.1)",
    bannerErrBorder: "rgba(244, 63, 94, 0.3)",
    chipWarnBg: "rgba(245, 158, 11, 0.15)",
    chipWarn: "#b45309",
  },
} as const;

type Theme = { [K in keyof typeof THEMES.dark]: string };

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);

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
  return token ? <Home onLogout={() => setTokenState(null)} /> : <Login onOk={() => setTokenState("1")} />;
}

// —— 登录（对齐 Web 登录页：居中品牌 + 玻璃输入 + 渐变主按钮） ——

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
      <Text style={s.logo}>☀️</Text>
      <Text style={[s.title, { color: t.title }]}>拾光</Text>
      <Text style={[s.sub, { color: t.inkMute }]}>钱 · 时间 · 人，一句话记下来</Text>
      <TextInput
        style={[s.input, { backgroundColor: t.surface, borderColor: t.lineSoft, color: t.ink }]}
        placeholder="手机号 / 邮箱" placeholderTextColor={t.inkFaint}
        autoCapitalize="none" keyboardType="email-address" value={phone} onChangeText={setPhone}
      />
      <TextInput
        style={[s.input, { backgroundColor: t.surface, borderColor: t.lineSoft, color: t.ink }]}
        placeholder="密码" placeholderTextColor={t.inkFaint}
        secureTextEntry value={password} onChangeText={setPassword}
      />
      {err && <Text style={[s.err, { color: t.danger }]}>{err}</Text>}
      <Pressable onPress={submit} disabled={busy} style={[s.gradBtnWrap, busy && { opacity: 0.6 }]}>
        <LinearGradient colors={["#0ea5e9", "#6366f1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradBtn}>
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={s.gradBtnText}>登录</Text>}
        </LinearGradient>
      </Pressable>
      <Text style={[s.hint, { color: t.inkFaint }]}>短信验证码登录请使用网页版 · 注册需邀请码</Text>
    </KeyboardAvoidingView>
  );
}

// —— 主界面：动态流 + 底部中央悬浮圆圈（点按=文字 / 长按=语音） ——

function Home({ onLogout }: { onLogout: () => void }) {
  const scheme = useColorScheme();
  const t = THEMES[scheme === "light" ? "light" : "dark"];
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
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

  const refresh = useCallback(async () => {
    try {
      setMoments(await loadFeed());
    } catch (e) {
      if (e instanceof Error && e.message.includes("401")) onLogout();
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    refresh();
    return () => {
      // 卸载时清理计时器与可能残留的录音
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
      // 16kHz 单声道 PCM WAV（GLM-ASR 全平台稳）
      const { recording: rec } = await Audio.Recording.createAsync({
        // Android：MediaRecorder 无 PCM 输出，DEFAULT(3gp/amr) GLM-ASR 不认；用 AAC/M4A（16kHz 单声道）
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
    setMsg({ ok: true, text: "录音已取消" });
  }

  // 悬浮圆圈手势（Responder 系统，无第三方手势库）：
  // 按下 → 500ms 内松开 = 点按打开文字面板；超过 = 起录；按住上滑 = 取消；松手 = 送识别
  function onGrant(e: { nativeEvent: { pageY: number } }) {
    if (recState !== "idle") return;
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
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    // 注意：录音中 recState 已是 "recording"，这里不能按 recState 拦截（否则松手被吞）。
    // 到点自动结束后才松手的场景：recordingRef 已清空，stopAndSend/discardRec 内部自会空转。
    if (!longFired.current) {
      setText("");
      setSheetOpen(true);
      return;
    }
    if (cancelArmed) discardRec();
    else void stopAndSend();
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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

  const recording = recState === "recording";

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      {/* 顶栏（对齐 Web 玻璃导航 pill） */}
      <View style={[s.nav, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
        <Text style={[s.navBrand, { color: t.title }]}>拾光</Text>
        <View style={[s.navChip, { backgroundColor: t.elevated }]}>
          <Text style={[s.navChipText, { color: t.inkSoft }]}>📝 动态</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={[s.navExit, { color: t.inkMute }]}>退出</Text>
        </Pressable>
      </View>
      <View style={s.head}>
        <Text style={[s.headTitle, { color: t.title }]}>
          拾光 <Text style={[s.headSub, { color: t.inkDim }]}>动态</Text>
        </Text>
        <Text style={[s.headDesc, { color: t.inkMute }]}>随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来待办</Text>
      </View>
      {msg && (
        <View
          style={[
            s.banner,
            msg.ok
              ? { backgroundColor: t.bannerOkBg, borderColor: t.bannerOkBorder }
              : { backgroundColor: t.bannerErrBg, borderColor: t.bannerErrBorder },
          ]}
        >
          <Text style={{ color: msg.ok ? t.success : t.danger, fontSize: 12, lineHeight: 18 }}>{msg.text}</Text>
        </View>
      )}
      {loading ? (
        <Center bg={t.bg}><ActivityIndicator color={t.accentBright} /></Center>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(x) => x.key}
          contentContainerStyle={s.list}
          renderItem={({ item }) =>
            item.kind === "day" ? (
              <Text style={[s.dayHead, { color: t.inkDim }]}>— {item.label} —</Text>
            ) : (
              <MomentCard m={item.m} t={t} />
            )
          }
          ListEmptyComponent={<Text style={[s.empty, { color: t.inkMute }]}>还没有动态，点下方圆圈说一句话开始 ✨</Text>}
        />
      )}

      {/* 录音/识别浮层：按住时全屏提示。pointerEvents=none 纯视觉，
          否则浮层插入手势中途会吃掉 FAB 的松手事件，导致录音停不下来 */}
      {recState !== "idle" && (
        <View style={[s.overlay, { backgroundColor: t.scrim }]} pointerEvents="none">
          <View style={[s.overlayCard, { backgroundColor: t.surface, borderColor: t.line }]}>
            {recording ? (
              <>
                <View style={s.recRow}>
                  <View style={[s.recDot, { backgroundColor: t.dangerSolid }]} />
                  <Text style={[s.recTime, { color: t.dangerSolid }]}>{mmss}</Text>
                </View>
                <Text style={[s.overlayHint, { color: t.inkMute }]}>
                  {cancelArmed ? "松开取消" : `松开识别文字 · 上滑取消（最长 ${VOICE_MAX_SECONDS} 秒）`}
                </Text>
              </>
            ) : (
              <>
                <ActivityIndicator color={t.accentBright} />
                <Text style={[s.overlayHint, { color: t.inkMute }]}>识别中…</Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* 底部中央悬浮圆圈：点按=文字，长按=语音（夜间浅蓝 / 日间奶白） */}
      <View style={s.fabWrap} pointerEvents="box-none">
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
      </View>

      {/* 文字输入面板：点按=空面板；语音转写结果回填预览，确认后才发布 */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <KeyboardAvoidingView style={s.sheetWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={[s.sheetBackdrop, { backgroundColor: t.scrim }]} onPress={() => setSheetOpen(false)} />
          <View style={[s.sheet, { backgroundColor: t.surface, borderTopColor: t.glassBorder }]}>
            <View style={s.sheetHead}>
              <Text style={[s.sheetTitle, { color: t.inkSoft }]}>记录此刻</Text>
              <Pressable onPress={() => setSheetOpen(false)} hitSlop={10}>
                <Text style={[s.sheetClose, { color: t.inkDim }]}>✕</Text>
              </Pressable>
            </View>
            <TextInput
              style={[s.sheetInput, { backgroundColor: t.bg, borderColor: t.lineSoft, color: t.ink }]}
              placeholder="说点什么…（试试“刚跑完步40分钟，心情不错”）"
              placeholderTextColor={t.inkFaint} value={text} onChangeText={setText}
              multiline autoFocus maxLength={2000}
            />
            <View style={s.sheetFoot}>
              <Text style={[s.sheetHint, { color: t.inkFaint }]}>发布后 AI 自动识别日程 / 待办 / 收支 / 心情</Text>
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

/** 动态卡片：结构/样式对齐 Web moment-feed 的玻璃卡片（头像圈 + 意图标签 + 原文 + 识别态 + 收益标签） */
function MomentCard({ m, t }: { m: Moment; t: Theme }) {
  const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  const time = new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
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
                  📋 {m.todos.length} 待办
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
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    marginBottom: 12, width: 280,
  },
  err: { fontSize: 12, marginBottom: 10 },
  gradBtnWrap: { width: 280, borderRadius: 12, overflow: "hidden" },
  gradBtn: { paddingVertical: 12, paddingHorizontal: 32, alignItems: "center", borderRadius: 12 },
  gradBtnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  hint: { fontSize: 11, marginTop: 18, textAlign: "center" },
  // 顶栏与标题（对齐 Web 玻璃导航 + 居中标题）
  nav: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 12, marginTop: 10, marginBottom: 4,
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
    padding: 14, marginBottom: 10,
  },
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
  // 底部中央悬浮圆圈
  fabWrap: {
    position: "absolute", bottom: 30, left: 0, right: 0,
    alignItems: "center",
  },
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
  overlayCard: {
    borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 28, paddingVertical: 22, alignItems: "center", gap: 10,
    minWidth: 220,
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot: { width: 12, height: 12, borderRadius: 6 },
  recTime: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
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
  sheetInput: {
    minHeight: 90, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, textAlignVertical: "top",
  },
  sheetFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  sheetHint: { fontSize: 11, flex: 1, marginRight: 10 },
  gradBtnWrapSheet: { borderRadius: 12, overflow: "hidden" },
  gradBtnSheet: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, alignItems: "center" },
});
