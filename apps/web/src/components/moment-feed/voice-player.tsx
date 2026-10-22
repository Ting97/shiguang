"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * 语音动态回放（自绘控件，替代原生 audio 灰条）：
 * - 渐变圆钮播放/暂停 + 可点可拖的进度条 + 时长（tabular-nums）
 * - 播放中 Mic 换三段均衡器动效（.vp-eq，globals.css keyframes）
 * - <audio> 隐藏承载播放；同源 cookie 鉴权天然可用；error 态降级文案
 * - PC 限宽 340px；移动端全宽（进度轨道 h-5 触控热区，拖拽 seek）
 */
export default function VoicePlayer({ storageKey }: { storageKey: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  // 拖拽态用 state（ref 不触发渲染，把手放大样式会停在拖拽前）
  const [dragging, setDragging] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCur(a.currentTime);
    const onMeta = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
      a.currentTime = 0;
    };
    const onErr = () => setErr(true);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onErr);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onErr);
    };
  }, []);

  // 轨道 seek：原生 pointer 监听（点击/拖拽；React 合成事件在部分渲染树里不触发的场景兜底）
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const seekToClient = (clientX: number) => {
      const a = audioRef.current;
      if (!a || !dur) return;
      const r = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      a.currentTime = ratio * dur;
      setCur(a.currentTime);
    };
    const down = (e: PointerEvent) => {
      draggingRef.current = true;
      setDragging(true);
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件 pointerId 无效 */
      }
      seekToClient(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (draggingRef.current) seekToClient(e.clientX);
    };
    const up = () => {
      draggingRef.current = false;
      setDragging(false);
    };
    track.addEventListener("pointerdown", down);
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
    return () => {
      track.removeEventListener("pointerdown", down);
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
    };
  }, [dur]);

  function toggle() {
    const a = audioRef.current;
    if (!a || err) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      // 播放真正开始前 pause() 会让 play() 以 AbortError 拒绝：这是快速「播放→暂停」的正常路径，
      // 不是加载失败（误标 err 会让播放器永久锁死在错误文案，无恢复入口）
      void a
        .play()
        .then(() => setPlaying(true))
        .catch((e: unknown) => {
          if ((e as Error)?.name === "AbortError") {
            setPlaying(false);
            return;
          }
          setErr(true);
        });
    }
  }

  return (
    <div className="mt-1.5 flex w-full items-center gap-2.5 rounded-xl border border-sky-500/25 bg-gradient-to-r from-sky-500/[0.08] to-indigo-500/[0.06] px-2.5 py-1.5 sm:w-[300px]">
      {err ? (
        <p className="min-w-0 flex-1 text-micro text-ink-faint">🎤 语音加载失败（文件可能已过期）</p>
      ) : (
        <>
          <button
            onClick={toggle}
            aria-label={playing ? "暂停语音" : "播放语音"}
            className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-md shadow-sky-500/25"
          >
            {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
          </button>
          {/* 播放中：微型均衡器；静止：麦） */}
          <span className="flex h-3 w-[10px] shrink-0 items-end justify-center gap-[2px]" aria-hidden>
            {playing ? (
              <>
                <i className="vp-eq inline-block h-full w-[2px] rounded-sm bg-accent" style={{ animationDelay: "0ms" }} />
                <i className="vp-eq inline-block h-full w-[2px] rounded-sm bg-accent" style={{ animationDelay: "180ms" }} />
                <i className="vp-eq inline-block h-full w-[2px] rounded-sm bg-accent" style={{ animationDelay: "360ms" }} />
              </>
            ) : (
              <Mic size={10} className="text-ink-faint" />
            )}
          </span>
          {/* 轨道：点击/拖拽 seek；键盘 ←/→ ±5s、Home/End 到头尾（role=slider 的键盘可达性） */}
          <div
            ref={trackRef}
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(cur)}
            tabIndex={0}
            onKeyDown={(e) => {
              const a = audioRef.current;
              if (!a || !dur) return;
              const step =
                e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : e.key === "Home" ? -dur : e.key === "End" ? dur : 0;
              if (!step) return;
              e.preventDefault();
              a.currentTime = Math.min(dur, Math.max(0, a.currentTime + step));
              setCur(a.currentTime);
            }}
            className="group flex h-4 min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
            // pointer 事件用原生监听（useEffect 挂载）：点击/拖拽均可 seek
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400"
                style={{ width: dur ? `${Math.min(100, (cur / dur) * 100)}%` : "0%" }}
              />
            </div>
            <span
              className={`pointer-events-none -ml-[5px] h-2.5 w-2.5 rounded-full bg-white shadow-md shadow-scrim/50 transition-transform ${
                playing || dragging ? "scale-100" : "scale-0 group-hover:scale-100"
              }`}
            />
          </div>
          <span className="shrink-0 text-[10px] leading-none tabular-nums text-ink-faint">
            {fmt(cur)}/{dur ? fmt(dur) : "--:--"}
          </span>
        </>
      )}
      <audio
        ref={audioRef}
        src={`/api/files/${storageKey}`}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
