"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { createVoiceRecorder, VOICE_MAX_SECONDS, type VoiceRecorderState } from "@/lib/voice-recorder";

/** 长按起录的等待时长（安卓长按标准 ~500ms）：松开早于它 = 点按打开文字面板 */
const LONG_PRESS_MS = 500;
/** 按住时上滑超过该像素视为「取消」手势 */
const CANCEL_SLIDE_PX = 80;
/** 首次使用提示的本地存储键：点按或录音用过一次后不再显示 */
const HINT_SEEN_KEY = "shiguang.captureHintSeen";

/**
 * 移动端发布悬浮圆圈（仅动态页、<sm 视口）：
 * **点按 = 打开文字输入面板；长按 = 按住说话，松开转文字回填面板，上滑取消**。
 * 录音管线复用 lib/voice-recorder.ts；转写结果交父级打开面板预览，确认后才发布。
 */
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
  onError: (msg: string) => void;
  /** 中性提示（已取消/没听到内容），父级可用非错误样式展示 */
  onHint?: (msg: string) => void;
}) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const recRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const startY = useRef(0);

  if (!recRef.current) {
    recRef.current = createVoiceRecorder({
      onState: setState,
      onTick: setSeconds,
      onText: onVoiceText,
      onError,
      onHint,
    });
  }
  const rec = recRef.current;
  useEffect(() => () => rec.destroy(), [rec]);

  useEffect(() => {
    try {
      setShowHint(localStorage.getItem(HINT_SEEN_KEY) !== "1");
    } catch {
      /* 隐私模式等 localStorage 不可用：直接不显示提示 */
    }
  }, []);

  const markHintSeen = () => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const clearPressTimer = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  function onDown(e: React.PointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成/异常 pointerId 下捕获失败不影响手势 */
    }
    startY.current = e.clientY;
    longFired.current = false;
    setCancelArmed(false);
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      markHintSeen();
      void rec.begin();
    }, LONG_PRESS_MS);
  }

  function onMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!longFired.current || rec.getState() !== "recording") return;
    const dy = startY.current - e.clientY; // 上滑为正
    // 带迟滞：越过 80px 进入取消态，滑回 40px 内退出
    if (dy > CANCEL_SLIDE_PX) setCancelArmed(true);
    else if (dy < CANCEL_SLIDE_PX / 2) setCancelArmed(false);
  }

  function onUp() {
    clearPressTimer();
    if (!longFired.current) {
      // 点按：打开文字面板
      markHintSeen();
      onTap();
      return;
    }
    if (cancelArmed) {
      if (rec.getState() === "recording") rec.discard();
      else rec.release(); // 还在起流：走「按住即松开」丢弃路径
      setCancelArmed(false);
      return;
    }
    rec.release(); // → transcribing → onText 回填面板
  }

  function onCancel() {
    clearPressTimer();
    setCancelArmed(false);
    rec.discard();
  }

  const recording = state === "recording";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <>
      {/* 录音/识别浮层：全屏蒙层（指针捕获在圆钮上，浮层不拦截手势事件流）；requesting=权限弹窗中不弹蒙层（该阶段此前无蒙层，别误显「识别中」） */}
      {state !== "idle" && state !== "requesting" && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-line-soft bg-surface px-8 py-6 text-center">
            {recording ? (
              <>
                <span className="flex h-10 items-center gap-2 text-2xl font-semibold tabular-nums text-danger">
                  <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-danger" />
                  {mmss}
                </span>
                <span className="text-xs text-ink-mute">{cancelArmed ? "松开取消" : `松开识别文字 · 上滑取消（最长 ${VOICE_MAX_SECONDS} 秒）`}</span>
              </>
            ) : (
              <>
                <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="text-xs text-ink-mute">识别中…</span>
              </>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="点按打字，长按说话"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))", touchAction: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
        className={`fixed left-1/2 z-40 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full shadow-lg shadow-black/40 transition capture-btn sm:hidden ${
          recording ? "capture-btn-rec" : ""
        } ${state === "transcribing" ? "opacity-60" : ""}`}
      >
        {state === "transcribing" ? (
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#0b1526] border-t-transparent" />
        ) : (
          <Mic size={24} className="text-[#0b1526]" />
        )}
      </button>

      {/* 首次使用提示：用过一次后消失 */}
      {showHint && state === "idle" && (
        <div className="pointer-events-none fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-line-soft bg-surface px-3 py-1 text-[11px] text-ink-mute sm:hidden">
          点按打字 · 长按说话
        </div>
      )}
    </>
  );
}
