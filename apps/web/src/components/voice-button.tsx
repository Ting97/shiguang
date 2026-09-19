"use client";

import { useRef, useState } from "react";

/**
 * 语音输入按钮：点击开始录音 → 再点停止 → GLM-ASR 转写 → 回调文本。
 * MediaRecorder 优先产出 webm/opus（Chrome/Edge），Safari 用 mp4。
 */
export default function VoiceButton({ onText, onError }: { onText: (text: string) => void; onError: (msg: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [seconds, setSeconds] = useState(0);

  async function toggle() {
    if (state === "transcribing") return;
    if (state === "recording") return stop();
    return start();
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => void finish();
      rec.start();
      recorderRef.current = rec;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setState("recording");
    } catch {
      onError("无法访问麦克风，请检查浏览器权限");
      setState("idle");
    }
  }

  function stop() {
    recorderRef.current?.stop(); // onstop 里转 finish
    if (timerRef.current) clearInterval(timerRef.current);
    setState("transcribing");
  }

  async function finish() {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    if (blob.size < 2000) {
      // 过短视为没说话（<2KB 基本是开启瞬间的静音帧）
      reset("录音太短，请按住说话");
      return;
    }
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

  const label =
    state === "transcribing" ? "…" : state === "recording" ? `🎙 ${seconds}s` : "🎙";
  const title = state === "recording" ? "点击停止并识别" : "点击说话";

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      className={`shrink-0 rounded-full border px-3 py-2 text-sm transition ${
        state === "recording"
          ? "animate-pulse border-rose-500/60 bg-rose-500/15 text-rose-300"
          : "border-white/10 bg-slate-900/60 text-slate-400 hover:border-sky-500/50 hover:text-sky-300"
      } ${state === "transcribing" ? "opacity-60" : ""}`}
    >
      {label}
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
