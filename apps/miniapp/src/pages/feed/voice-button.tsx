/**
 * 语音发布按钮：长按起录 → 松手停并转写 → 文字填入发布框（不自动发布，用户确认后手动发）。
 *
 * 坑：
 * - RecorderManager 是小程序 App 级全局单例：useRef 保存、onStop/onError 只注册一次，
 *   回调经 ref 转发到最新闭包（重复注册会互相覆盖 / 重复触发）
 * - 轻点（未满 onLongPress 阈值）也会触发 onTouchEnd：用 phase ref 区分，未录音直接忽略，
 *   否则 stop() 会在未录音时 fail
 * - 录满 duration 上限（30s）系统会自动 stop，同样走 onStop → 正常转写
 * - format wav / sampleRate 16000 / 单声道：与 /api/asr 的 GLM-ASR 对齐（后端只认 wav/mp3；
 *   部分开发者工具版本不支持 wav 录制，需真机验证）
 * - 松手瞬间 touchend 与 touchcancel 可能连发：finish 里先摘 recording 态防重入
 */
import { useEffect, useRef, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { transcribeAudio } from "@/lib/api";
import "./voice-button.scss";

type Phase = "idle" | "recording" | "transcribing";

/** onStop 回调的真实形态（duration 供「说话太短」判断，部分机型可能缺省） */
interface StopResult {
  tempFilePath?: string;
  duration?: number;
  fileSize?: number;
}

export default function VoiceButton({
  onText,
  onError,
  disabled,
}: {
  /** 转写结果回调：父级填入发布框（不自动发布） */
  onText: (text: string) => void;
  /** 失败冒泡到页面 banner（服务端错误文案已中文） */
  onError: (msg: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  // phase 同时存 ref：Taro 手势回调与 RecorderManager 回调都要读「当前态」，state 在闭包里会过期
  const phaseRef = useRef<Phase>("idle");
  const recRef = useRef<Taro.RecorderManager | null>(null);
  // 单例上 onStop 只能注册一次：用 ref 指向最新的处理函数
  const stopRef = useRef<(res: StopResult) => void>(() => {});

  function setBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function ensureRec(): Taro.RecorderManager {
    if (!recRef.current) {
      const rec = Taro.getRecorderManager();
      rec.onStop((res) => stopRef.current((res ?? {}) as StopResult));
      rec.onError((err) => {
        setBoth("idle");
        const msg = String(err?.errMsg ?? "");
        // 授权拒绝是最常见的失败：errMsg 含 auth/deny，文案要指路设置页
        onError(msg.includes("auth") || msg.includes("deny") ? "未授权麦克风，请到设置里开启后重试" : `录音失败：${msg || "未知错误"}`);
      });
      recRef.current = rec;
    }
    return recRef.current;
  }

  async function handleStop(res: StopResult) {
    // 两条路径都会进这里：松手 stop()（phase 已切 transcribing）、系统 30s 自动停（phase 还是 recording）
    if (phaseRef.current !== "recording" && phaseRef.current !== "transcribing") return;
    const path = res.tempFilePath;
    if (!path) {
      setBoth("idle");
      onError("录音失败，请重试");
      return;
    }
    // <1s 基本转不出内容：本地直接拦，省一次必 422 的请求
    if (typeof res.duration === "number" && res.duration < 1000) {
      setBoth("idle");
      onError("说话时间太短，请长按后松手");
      return;
    }
    setBoth("transcribing");
    try {
      const { text } = await transcribeAudio(path);
      if (text) onText(text);
      else onError("没有听清内容，请再试一次");
    } catch (e: any) {
      onError(e?.message ?? "语音识别失败");
    } finally {
      setBoth("idle");
    }
  }

  // 每次渲染把最新闭包挂到 ref，保证 onStop 里拿到的是最新的 onText/onError
  stopRef.current = (res) => {
    void handleStop(res);
  };

  function start() {
    if (disabled || phaseRef.current !== "idle") return;
    // 参数契约：wav / 16000Hz / 单声道 / ≤30s（README 约定 + /api/asr 只认 wav/mp3）
    ensureRec().start({ format: "wav", sampleRate: 16000, numberOfChannels: 1, duration: 30000 });
    // start 失败（如未授权麦克风）会走 onError 统一兜回 idle
    setBoth("recording");
  }

  function finish() {
    if (phaseRef.current !== "recording") return; // 轻点未起录：忽略（未录音时 stop() 会 fail）
    // 先摘 recording 防重入（touchend / touchcancel 连发），再 stop；结果统一走 onStop → handleStop
    setBoth("transcribing");
    recRef.current?.stop();
  }

  // 卸载兜底：还在录音必须停掉，否则单例 manager 会把录音带到下一个页面
  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* 未在录音等场景的 fail 静默 */
      }
    },
    [],
  );

  const label = phase === "recording" ? "正在聆听… 松手转文字" : phase === "transcribing" ? "识别中…" : "🎤 按住说话";

  return (
    <View
      className={`voice-btn ${phase !== "idle" ? "recording" : ""} ${disabled ? "disabled" : ""}`}
      onLongPress={start}
      onTouchEnd={finish}
      onTouchCancel={finish}
    >
      <Text>{label}</Text>
    </View>
  );
}
