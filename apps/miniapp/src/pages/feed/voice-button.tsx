/**
 * 底部悬浮发布钮（= web components/capture-button.tsx）：
 * **点按 = 打开文字输入面板；长按 = 按住说话，松开转文字回填面板，上滑取消**。
 * 长按手势：onTouchStart 起 500ms 定时器（安卓长按标准），到时进录音；松开早于它 = 点按。
 * 录音管线：RecorderManager 单例 wav/16kHz/单声道 ≤30s → /api/asr（GLM-ASR 只认 wav/mp3）。
 *
 * 坑（沿用旧版注释）：
 * - RecorderManager 是 App 级全局单例：onStop/onError 只注册一次，回调经 ref 转发最新闭包
 * - 松手瞬间 touchend 与 touchcancel 可能连发：finish 里先摘 recording 态防重入
 * - 录满 duration 上限系统自动 stop，同样走 onStop 正常转写
 * - 「上滑取消」：touchend 前已达 80px 则丢弃录音（dropping 标记让 onStop 白拿结果）
 */
import { useEffect, useRef, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { transcribeAudio } from "@/lib/api";
import "./voice-button.scss";

/** 长按起录的等待时长（= web LONG_PRESS_MS） */
const LONG_PRESS_MS = 500;
/** 按住时上滑超过该像素（真实 px）视为「取消」手势（= web CANCEL_SLIDE_PX） */
const CANCEL_SLIDE_PX = 80;
/** 录音最长秒数（= web VOICE_MAX_SECONDS，与 duration 参数一致） */
const VOICE_MAX_SECONDS = 30;
/** 首次使用提示的本地存储键：点按或录音用过一次后不再显示（= web HINT_SEEN_KEY） */
const HINT_SEEN_KEY = "shiguang.captureHintSeen";

type Phase = "idle" | "recording" | "transcribing";

/** onStop 回调的真实形态（duration 供「说话太短」判断，部分机型可能缺省） */
interface StopResult {
  tempFilePath?: string;
  duration?: number;
  fileSize?: number;
}

export default function CaptureButton({
  onTap,
  onVoiceText,
  onError,
  onHint,
}: {
  /** 点按（未到长按门槛松开）→ 父级打开空文字面板 */
  onTap: () => void;
  /** 长按说话松开且转写成功 → 父级打开面板并带入文字 */
  onVoiceText: (text: string) => void;
  /** 失败冒泡到页面横幅 */
  onError: (msg: string) => void;
  /** 中性提示（已取消/没听到内容），父级用成功样式展示 */
  onHint: (msg: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // phase 同时存 ref：touch 回调与 RecorderManager 回调都要读「当前态」，state 在闭包里会过期
  const phaseRef = useRef<Phase>("idle");
  const recRef = useRef<Taro.RecorderManager | null>(null);
  const stopRef = useRef<(res: StopResult) => void>(() => {});
  // 上滑取消：true 时 onStop 直接丢弃录音文件
  const droppingRef = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const longFired = useRef(false);
  const startY = useRef(0);
  const cancelArmedRef = useRef(false);

  function setBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  useEffect(() => {
    try {
      setShowHint(Taro.getStorageSync(HINT_SEEN_KEY) !== "1");
    } catch {
      /* storage 不可用：直接不显示提示 */
    }
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (tickTimer.current) clearInterval(tickTimer.current);
      // 卸载兜底：还在录音必须停掉，否则单例 manager 会把录音带到下一个页面
      try {
        recRef.current?.stop();
      } catch {
        /* 未在录音等场景的 fail 静默 */
      }
    };
  }, []);

  const markHintSeen = () => {
    setShowHint(false);
    try {
      Taro.setStorageSync(HINT_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const clearPressTimer = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const clearTick = () => {
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = null;
  };

  function ensureRec(): Taro.RecorderManager {
    if (!recRef.current) {
      const rec = Taro.getRecorderManager();
      rec.onStop((res) => stopRef.current((res ?? {}) as StopResult));
      rec.onError((err) => {
        clearTick();
        droppingRef.current = false;
        setBoth("idle");
        const msg = String(err?.errMsg ?? "");
        // 授权拒绝是最常见的失败：errMsg 含 auth/deny，文案要指路设置页
        onError(msg.includes("auth") || msg.includes("deny") ? "未授权麦克风，请到设置里开启后重试" : `录音失败：${msg || "未知错误"}`);
      });
      recRef.current = rec;
    }
    return recRef.current;
  }

  function begin() {
    if (phaseRef.current !== "idle") return;
    ensureRec().start({ format: "wav", sampleRate: 16000, numberOfChannels: 1, duration: VOICE_MAX_SECONDS * 1000 });
    // start 失败（如未授权麦克风）会走 onError 统一兜回 idle
    setBoth("recording");
    setSeconds(0);
    clearTick();
    tickTimer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  /** 松手 → 停止录音进转写（结果统一走 onStop → handleStop） */
  function release() {
    if (phaseRef.current !== "recording") return;
    clearTick();
    setBoth("transcribing");
    recRef.current?.stop();
  }

  /** 上滑取消 / 打断：丢弃录音 */
  function discard() {
    clearTick();
    if (phaseRef.current !== "recording") return;
    droppingRef.current = true;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    setBoth("idle");
    recRef.current?.stop();
  }

  async function handleStop(res: StopResult) {
    clearTick();
    if (droppingRef.current) {
      droppingRef.current = false;
      return;
    }
    if (phaseRef.current !== "recording" && phaseRef.current !== "transcribing") return;
    const path = res.tempFilePath;
    if (!path) {
      setBoth("idle");
      onError("录音失败，请重试");
      return;
    }
    // <1s 基本转不出内容：本地直接拦，省一次必 422 的请求（中性提示，非错误）
    if (typeof res.duration === "number" && res.duration < 1000) {
      setBoth("idle");
      onHint("说话时间太短，请长按后松手");
      return;
    }
    setBoth("transcribing");
    try {
      const { text } = await transcribeAudio(path);
      if (text) onVoiceText(text);
      else onHint("没有听清内容，请再试一次");
    } catch (e: any) {
      onError(e?.message ?? "语音识别失败");
    } finally {
      setBoth("idle");
    }
  }

  // 每次渲染把最新闭包挂到 ref，保证 onStop 里拿到的是最新的 onVoiceText/onError/onHint
  stopRef.current = (res) => {
    void handleStop(res);
  };

  function onTouchStart(e: any) {
    startY.current = e?.touches?.[0]?.clientY ?? 0;
    longFired.current = false;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      markHintSeen();
      begin();
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e: any) {
    if (!longFired.current || phaseRef.current !== "recording") return;
    const dy = startY.current - (e?.touches?.[0]?.clientY ?? 0); // 上滑为正
    // 带迟滞：越过 80px 进入取消态，滑回 40px 内退出（= web 同款）
    if (dy > CANCEL_SLIDE_PX) {
      cancelArmedRef.current = true;
      setCancelArmed(true);
    } else if (dy < CANCEL_SLIDE_PX / 2) {
      cancelArmedRef.current = false;
      setCancelArmed(false);
    }
  }

  function onTouchEnd() {
    clearPressTimer();
    if (!longFired.current) {
      // 点按：打开文字面板
      markHintSeen();
      onTap();
      return;
    }
    if (cancelArmedRef.current) {
      discard();
      return;
    }
    release(); // → transcribing → onStop → onVoiceText 回填面板
  }

  function onTouchCancel() {
    clearPressTimer();
    if (longFired.current) discard();
  }

  const recording = phase === "recording";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <>
      {/* 录音/识别浮层：全屏蒙层（手势事件流仍在圆钮上，蒙层不拦截）；微信授权弹窗阶段无蒙层 */}
      {phase !== "idle" ? (
        <View className="voice-overlay">
          <View className="voice-card">
            {recording ? (
              <>
                <View className="voice-timer">
                  <View className="voice-dot" />
                  <Text>{mmss}</Text>
                </View>
                <Text className="voice-hint">{cancelArmed ? "松开取消" : `松开识别文字 · 上滑取消（最长 ${VOICE_MAX_SECONDS} 秒）`}</Text>
              </>
            ) : (
              <>
                <View className="voice-spin" />
                <Text className="voice-hint">识别中…</Text>
              </>
            )}
          </View>
        </View>
      ) : null}

      <View
        className={`fab-capture${recording ? " capture-rec" : ""}${phase === "transcribing" ? " capture-busy" : ""}`}
        aria-label="点按打字，长按说话"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <Text className="fab-icon">{phase === "transcribing" ? "" : "🎙"}</Text>
        {phase === "transcribing" ? <View className="fab-spin" /> : null}
      </View>

      {/* 首次使用提示：用过一次后消失 */}
      {showHint && phase === "idle" ? (
        <View className="capture-hint">
          <Text>点按打字 · 长按说话</Text>
        </View>
      ) : null}
    </>
  );
}
