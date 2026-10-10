"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import VoiceButton from "@/components/voice-button";
import { toast } from "@/shared/ui/toast";
import type { DesktopImage } from "./types";

interface Props {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  onSubmit: () => void;
  images: DesktopImage[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (index: number) => void;
  onRetryUpload: () => Promise<void>;
  /** 语音动态：暂存的录音秒数（null=无）；chip 展示与移除 */
  voiceSeconds: number | null;
  onRemoveVoice: () => void;
  onVoiceAudio: (wav: Blob, seconds: number) => void;
}

/** 输入区（桌面端；移动端改用底部悬浮圆圈：点按打字 / 长按说话） */
export default function DesktopComposer({
  text,
  setText,
  inputRef,
  busy,
  onSubmit,
  images,
  fileInputRef,
  onAddImages,
  onRemoveImage,
  onRetryUpload,
  voiceSeconds,
  onRemoveVoice,
  onVoiceAudio,
}: Props) {
  return (
    <section className="mb-3 hidden sm:block">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={2}
        maxLength={2000}
        placeholder='记录此刻…（试试"刚跑完步40分钟，心情不错"、"有点累"、"明天下午三点看牙"）'
        className="input-glow w-full resize-none rounded-xl border border-line-soft bg-surface/60 px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 图片按钮：相册多选 ≤9 张（发布后并行上传） */}
          <label
            title="添加图片（最多 9 张）"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-line-soft bg-surface/60 text-base transition hover:border-sky-500/60"
          >
            🖼
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                onAddImages(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
          <VoiceButton
            onText={(t) => setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
            onAudio={onVoiceAudio}
            onError={(m) => toast(m, "err")}
            onHint={(m) => toast(m)}
          />
          <span className="hidden text-micro text-ink-faint sm:block">🎤 按住说话 · Enter 发布</span>
        </div>
        <div className="flex items-center gap-3">
          {/* 接近上限才显示字数，与发布弹层口径一致 */}
          {text.length >= 1800 && (
            <span className={`text-micro tabular-nums ${text.length >= 1950 ? "text-danger" : "text-ink-faint"}`}>
              {text.length}/2000
            </span>
          )}
          <button
            onClick={onSubmit}
            disabled={busy || !text.trim()}
            className="btn-primary rounded-xl px-7 py-2 text-sm font-medium"
          >
            {busy ? "识别中…" : "发布"}
          </button>
        </div>
      </div>
      {/* 语音动态 chip：录音已暂存，随发布上传（可移除） */}
      {voiceSeconds != null && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-micro text-accent">
            🎤 语音已附加 {Math.floor(voiceSeconds / 60)}:{String(voiceSeconds % 60).padStart(2, "0")}
            <button onClick={onRemoveVoice} title="移除语音" className="tap-lg rounded-full bg-black/30 px-1 leading-none text-white">
              ✕
            </button>
          </span>
        </div>
      )}
      {/* 已选图片缩略条（可移除；上传失败可重试） */}
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((img, i) => (
            <span key={img.url} className={`relative overflow-hidden rounded-lg border ${img.status === "error" ? "border-rose-500/60" : "border-line-soft"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-14 w-14 object-cover" />
              {img.status === "error" ? (
                <button
                  onClick={() => onRetryUpload()}
                  title="重新上传"
                  className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white"
                >
                  ↻ 重试
                </button>
              ) : (
                <button
                  onClick={() => onRemoveImage(i)}
                  title="移除"
                  className="tap-lg absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-micro text-white"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
