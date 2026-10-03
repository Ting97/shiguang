/**
 * 动态屏（REQ-009 9-D 拆分自 App.tsx）：动态流 + 底部中央悬浮圆圈（点按=文字 / 长按=语音）。
 * 9-D 新增：loadFeed offset 无限翻页（触底 loadMore + 「加载中/没有更多」footer）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, useColorScheme } from "react-native";
import Animated, { FadeInDown, FadeOut, SlideInDown, useSharedValue, withSpring } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import { useTheme } from "../theme";
import { loadFeed, sendText, transcribe, type Moment } from "../api";
import { FEED_PAGE_SIZE, AUTO_STOP_MS, CANCEL_SLIDE_PX, LONG_PRESS_MS, MIN_HOLD_MS, VOICE_MAX_SECONDS } from "../consts";
import { haptic } from "../haptic";
import { s } from "../styles";
import TopNav, { type ScreenKey } from "../components/TopNav";
import AuroraBackground from "../components/AuroraBackground";
import SkeletonCard from "../components/SkeletonCard";
import MomentCard from "../components/MomentCard";
import PushToggle from "../components/PushToggle";
import RecordingOverlay, { type RecState } from "../components/RecordingOverlay";
import VoiceFab from "../components/VoiceFab";
import RecordSheet from "../components/RecordSheet";

export default function FeedScreen({ onLogout, onScreen }: { onLogout: () => void; onScreen?: (s: ScreenKey) => void }) {
  const scheme = useColorScheme();
  const t = useTheme();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 无限翻页（REQ-009 9-D）：hasMore 由服务端 total 判定，loadingMore 防止触底重复请求
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recState, setRecState] = useState<RecState>("idle");
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
      const page = await loadFeed({ limit: FEED_PAGE_SIZE, offset: 0 });
      setMoments(page.moments);
      setHasMore(page.moments.length < page.total);
    } catch (e) {
      if (e instanceof Error && e.message.includes("401")) onLogout();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onLogout]);

  /** 触底加载下一页：offset=现有条数；失败静默（下次触底重试）；按 id 去重防翻页间隙插入新动态导致重复 */
  const loadMore = useCallback(async () => {
    if (loading || refreshing || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await loadFeed({ limit: FEED_PAGE_SIZE, offset: moments.length });
      setMoments((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...page.moments.filter((m) => !ids.has(m.id))];
      });
      setHasMore(page.moments.length > 0 && moments.length + page.moments.length < page.total);
    } catch {
      // 翻页失败静默：footer 保持原状，再次触底会重试
    } finally {
      setLoadingMore(false);
    }
  }, [loading, refreshing, loadingMore, hasMore, moments]);

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

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AuroraBackground t={t} />

      {/* 顶栏：真毛玻璃 pill（对齐 Web 玻璃导航）；🔔=推送开关（默认关，REQ-009 9-D） */}
      <TopNav t={t} scheme={scheme} active="feed" onTab={onScreen} onLogout={onLogout} extra={<PushToggle />} />

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
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footer}>
                <ActivityIndicator color={t.accentBright} size="small" />
                <Text style={[s.footerText, { color: t.inkDim }]}>加载中…</Text>
              </View>
            ) : !hasMore && moments.length > 0 ? (
              <Text style={[s.footerText, { color: t.inkDim }]}>— 没有更多了 —</Text>
            ) : null
          }
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
      <RecordingOverlay t={t} scheme={scheme} recState={recState} seconds={seconds} cancelArmed={cancelArmed} />

      {/* 底部中央悬浮圆圈：点按=文字，长按=语音（夜间浅蓝 / 日间奶白）+ 呼吸微光 + 录音脉冲环 */}
      <VoiceFab
        t={t} recState={recState} cancelArmed={cancelArmed} fabScale={fabScale}
        onGrant={onGrant} onMove={onMove} onRelease={onRelease} onTerminate={discardRec}
      />

      {/* 文字输入面板：点按=空面板；语音转写结果回填预览，确认后才发布 */}
      <RecordSheet
        t={t} scheme={scheme} visible={sheetOpen} onClose={() => setSheetOpen(false)}
        text={text} onTextChange={setText} sending={sending} onSend={send}
      />
    </View>
  );
}
