/**
 * 语音录音管线（Web 端共用）：getUserMedia → MediaRecorder → 解码重采样 16kHz WAV → POST /api/asr。
 * 从 voice-button.tsx 抽出为可复用状态机，供桌面听写按钮与移动端悬浮圆圈共用。
 * 状态流转：idle → (begin) requesting → recording → (release) transcribing → (onText) idle；
 * discard 在录音中任意时刻丢弃。音频仅内存中转，服务器不落盘。
 * handlers 需传稳定引用（创建时捕获一次，后续不更新）。
 */
import { apiForm } from "@/shared/api";

/** requesting = getUserMedia 权限申请中（同步占位，防止弹窗期间二次 begin() 重入泄漏麦克风流） */
export type VoiceRecorderState = "idle" | "requesting" | "recording" | "transcribing";

/** 长按说话上限：30 秒（GLM-ASR 单文件限制 0–30s，超时被拒） */
export const VOICE_MAX_SECONDS = 30;
/** 自动停止阈值：留 1 秒余量，确保送识别的文件不超过 GLM-ASR 的 30s 上限 */
const AUTO_STOP_MS = (VOICE_MAX_SECONDS - 1) * 1000;
/** 短于此时长视为误触，不送识别 */
const MIN_HOLD_MS = 600;

export interface VoiceRecorderHandlers {
  onState: (s: VoiceRecorderState) => void;
  /** 录音中每秒回调一次累计秒数 */
  onTick?: (seconds: number) => void;
  onText: (text: string) => void;
  onError: (msg: string) => void;
  /** 中性提示（误触/已录满/已取消），缺省复用 onError */
  onHint?: (msg: string) => void;
}

export function createVoiceRecorder(h: VoiceRecorderHandlers) {
  let state: VoiceRecorderState = "idle";
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let seconds = 0;
  let startAt = 0;
  // 按下后 getUserMedia 尚未就绪时松开 → 记下取消意图，流到手即拆（视为按太短）
  let releaseBeforeReady = false;
  // 到点自动结束（区别于松开，结束时给「已录满」提示）
  let autoStop = false;
  // destroy 后拆干净并不再触发任何回调
  let dead = false;

  const note = (msg: string) => {
    if (!dead) (h.onHint ?? h.onError)(msg);
  };
  const setState = (s: VoiceRecorderState) => {
    state = s;
    if (!dead) h.onState(s);
  };
  const backToIdle = () => {
    setState("idle");
    seconds = 0;
    if (!dead) h.onTick?.(0);
  };
  function teardownTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    if (autoStopTimer) clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  async function begin() {
    if (state !== "idle") return; // 转写中、已在录或权限申请中
    setState("requesting"); // 同步占位：getUserMedia 弹窗期间二次 begin() 不再重入（旧实现等 await 返回才置态，会泄漏第一路麦克风流）
    releaseBeforeReady = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (dead) {
        s.getTracks().forEach((t) => t.stop());
        setState("idle"); // 回滚占位态（dead 时 onState 不外发）
        return;
      }
      if (releaseBeforeReady) {
        // 按下期间已松开：拆流不录，按太短提示
        s.getTracks().forEach((t) => t.stop());
        setState("idle"); // 回滚占位态
        note("按住说话，松开后自动识别");
        return;
      }
      stream = s;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => void finish();
      rec.start();
      recorder = rec;
      startAt = Date.now();
      autoStop = false;
      seconds = 0;
      if (!dead) h.onTick?.(0);
      timer = setInterval(() => {
        seconds += 1;
        if (!dead) h.onTick?.(seconds);
      }, 1000);
      // 到点自动结束（独立于显示用的秒表，留 1s 余量防超 GLM-ASR 30s 上限）
      autoStopTimer = setTimeout(() => {
        autoStop = true;
        stopRecorder();
      }, AUTO_STOP_MS);
      setState("recording");
    } catch {
      // MediaRecorder 构造/rec.start() 失败也必须拆流回 idle，否则麦克风直到页面刷新都被占用
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      setState("idle");
      if (!dead) h.onError("无法访问麦克风，请检查浏览器权限");
    }
  }

  /** 停止录音（onstop 里走 finish 转写）；幂等 */
  function stopRecorder() {
    const rec = recorder;
    if (!rec) return;
    recorder = null;
    teardownTimer();
    setState("transcribing");
    if (rec.state !== "inactive") rec.stop();
  }

  /** 松开：已开录则停止送识别；还在起流（含权限申请中）则记取消意图 */
  function release() {
    if (state === "recording") return stopRecorder();
    if (state === "idle" || state === "requesting") releaseBeforeReady = true;
  }

  /** 中断（来电/切走/上滑取消）：丢弃，不送识别 */
  function discard() {
    if (state !== "recording") return;
    const rec = recorder;
    recorder = null;
    teardownTimer();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    backToIdle();
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    note("录音已取消");
  }

  async function finish() {
    const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
    const live = stream;
    stream = null;
    live?.getTracks().forEach((t) => t.stop());
    const heldMs = Date.now() - startAt;
    const wasAuto = autoStop;
    if (blob.size < 2000 || heldMs < MIN_HOLD_MS) {
      // 过短/静音视为误触（<2KB 基本是静音帧）：中性提示而非错误
      backToIdle();
      note("没听到内容，请按住说话再松开");
      return;
    }
    if (wasAuto) note(`已录满 ${VOICE_MAX_SECONDS} 秒，自动结束并识别`);
    try {
      // GLM-ASR 不收 webm/opus：统一解码重采样为 16kHz 单声道 WAV 上传
      const wav = await blobToWav16k(blob);
      const form = new FormData();
      form.append("file", wav, "voice.wav");
      const j = await apiForm<{ text?: string }>("/api/asr", form);
      if (!j.text) throw new Error("没有听清内容，请再试一次");
      backToIdle();
      if (!dead) h.onText(String(j.text));
    } catch (e) {
      live?.getTracks().forEach((t) => t.stop());
      backToIdle();
      if (!dead) h.onError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 组件卸载时调用：拆流停表，之后不再触发回调 */
  function destroy() {
    dead = true;
    teardownTimer();
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorder = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  return { begin, release, discard, destroy, getState: () => state };
}

/** 录音 blob → 解码 → 线性重采样 16kHz 单声道 → PCM16 WAV（GLM-ASR 不收 webm/opus，wav 全平台支持） */
async function blobToWav16k(blob: Blob): Promise<Blob> {
  const ab = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(ab);
  } finally {
    // 解码失败也要关闭上下文（泄漏累积后浏览器会拒绝新建 AudioContext，录音从此不可用）
    ctx.close().catch(() => {});
  }
  const targetRate = 16000;
  const channels = audio.numberOfChannels;
  const srcLen = audio.length;
  const outLen = Math.ceil((srcLen * targetRate) / audio.sampleRate);
  const mono = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = Math.min(Math.floor((i * audio.sampleRate) / targetRate), srcLen - 1);
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += audio.getChannelData(c)[src] ?? 0;
    mono[i] = sum / channels;
  }

  const pcm = new ArrayBuffer(44 + outLen * 2);
  const view = new DataView(pcm);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + outLen * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([pcm], { type: "audio/wav" });
}
