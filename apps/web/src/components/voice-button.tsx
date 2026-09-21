"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { createVoiceRecorder, VOICE_MAX_SECONDS, type VoiceRecorderState } from "@/lib/voice-recorder";

/**
 * 语音输入按钮（桌面端听写）：**按住说话，松开结束**（微信式长按交互，点击不再触发录音）。
 * 录音/转写管线在 lib/voice-recorder.ts（与移动端悬浮圆圈共用）。
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
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  if (!recRef.current) {
    recRef.current = createVoiceRecorder({
      onState: setState,
      onTick: setSeconds,
      onText,
      onError,
      onHint: onHint ?? onError,
    });
  }
  const rec = recRef.current;
  useEffect(() => () => rec.destroy(), [rec]);

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const maxLabel = `${Math.floor(VOICE_MAX_SECONDS / 60)}:${String(VOICE_MAX_SECONDS % 60).padStart(2, "0")}`;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* 合成/异常 pointerId 下捕获失败不影响录音 */
        }
        void rec.begin();
      }}
      onPointerUp={() => rec.release()}
      onPointerCancel={() => rec.discard()}
      onContextMenu={(e) => e.preventDefault()}
      title="按住说话，松开结束（最长 30 秒）"
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
          {mmss} / {maxLabel}
        </span>
      ) : state === "transcribing" ? (
        <span className="text-[11px]">识别中…</span>
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}
