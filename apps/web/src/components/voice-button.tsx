"use client";

import { useRef, useState } from "react";
import { Mic } from "lucide-react";

/** 长按说话上限：2 分钟（到点自动结束并识别） */
const MAX_SECONDS = 120;
/** 短于此时长视为误触，不送识别 */
const MIN_HOLD_MS = 600;

/**
 * 语音输入按钮：**按住说话，松开结束**（微信式长按交互，点击不再触发录音）。
 * 录满 2 分钟自动结束；松开/到点 → GLM-ASR 转写 → 回调文本。
 * MediaRecorder 优先产出 webm/opus（Chrome/Edge），Safari 用 mp4。
 * 音频仅内存中转（浏览器→转写接口），服务器不落盘。
 */
export default function VoiceButton({
  onText,
  onError,
  onHint,
}: {
  onText: (text: string) => void;
  onError: (msg: string) => void;
  /** 中性提示（如录满自动结束），缺省复用 onError */
  onHint?: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [seconds, setSeconds] = useState(0);
  // 按下后 getUserMedia 尚未就绪时松开 → 记下取消意图，流到手即拆（视为按太短）
  const releaseBeforeReady = useRef(false);
  // 到点自动结束（区别于松开，结束时给「已录满」提示）
  const autoStop = useRef(false);
  const startAt = useRef(0);

  const notify = (msg: string) => (onHint ?? onError)(msg);

  function teardownTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function begin() {
    if (state !== "idle") return; // 转写中或已在录
    releaseBeforeReady.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (releaseBeforeReady.current) {
        // 按下期间已松开：拆流不录，按太短提示
        stream.getTracks().forEach((t) => t.stop());
        notify("按住说话，松开后自动识别");
        return;
      }
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => void finish();
      rec.start();
      recorderRef.current = rec;
      startAt.current = Date.now();
      autoStop.current = false;
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
        if (Date.now() - startAt.current >= MAX_SECONDS * 1000) {
          autoStop.current = true;
          stopRecorder();
        }
      }, 1000);
      setState("recording");
    } catch {
      onError("无法访问麦克风，请检查浏览器权限");
      setState("idle");
    }
  }

  /** 停止录音（onstop 里走 finish 转写）；幂等 */
  function stopRecorder() {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    teardownTimer();
    setState("transcribing");
    if (rec.state !== "inactive") rec.stop();
  }

  /** 松开：已开录则停止送识别；还在起流则记取消意图 */
  function release() {
    if (state === "recording") return stopRecorder();
    if (state === "idle") releaseBeforeReady.current = true;
  }

  /** 中断（来电/切走等 pointercancel）：丢弃，不送识别 */
  function discard() {
    if (state !== "recording") return;
    const rec = recorderRef.current;
    recorderRef.current = null;
    teardownTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("idle");
    setSeconds(0);
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    notify("录音已取消");
  }

  async function finish() {
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const heldMs = Date.now() - startAt.current;
    const wasAuto = autoStop.current;
    if (blob.size < 2000 || heldMs < MIN_HOLD_MS) {
      // 过短/静音视为误触（<2KB 基本是静音帧）：中性提示而非错误
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setState("idle");
      setSeconds(0);
      notify("没听到内容，请按住说话再松开");
      return;
    }
    if (wasAuto) notify("已录满 2 分钟，自动结束并识别");
    try {
      // GLM-ASR 不收 webm/opus：统一解码重采样为 16kHz 单声道 WAV 上传
      const wav = await blobToWav16k(blob);
      const form = new FormData();
      form.append("file", wav, "voice.wav");
      const r = await fetch("/api/asr", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `识别失败(${r.status})`);
      if (!j.text) throw new Error("没有听清内容，请再试一次");
      onText(String(j.text));
      setState("idle");
      setSeconds(0);
    } catch (e) {
      reset(e instanceof Error ? e.message : String(e));
    }
  }

  function reset(errMsg: string) {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setState("idle");
    setSeconds(0);
    onError(errMsg);
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* 合成/异常 pointerId 下捕获失败不影响录音 */
        }
        void begin();
      }}
      onPointerUp={release}
      onPointerCancel={discard}
      onContextMenu={(e) => e.preventDefault()}
      title="按住说话，松开结束（最长 2 分钟）"
      aria-label="按住说话，松开结束"
      style={{ touchAction: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
      className={`shrink-0 select-none rounded-full border px-3 py-2 text-sm transition ${
        state === "recording"
          ? "animate-pulse border-rose-500/60 bg-rose-500/15 text-danger"
          : "border-line-soft bg-surface/60 text-ink-mute hover:border-sky-500/50 hover:text-accent active:border-rose-500/60 active:bg-rose-500/10"
      } ${state === "transcribing" ? "opacity-60" : ""}`}
    >
      {state === "recording" ? (
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
          {mmss} / 2:00
        </span>
      ) : state === "transcribing" ? (
        <span className="text-[11px]">识别中…</span>
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}

/** 录音 blob → 解码 → 线性重采样 16kHz 单声道 → PCM16 WAV（GLM-ASR 不收 webm/opus，wav 全平台支持） */
async function blobToWav16k(blob: Blob): Promise<Blob> {
  const ab = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const audio = await ctx.decodeAudioData(ab);
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
  await ctx.close();

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
