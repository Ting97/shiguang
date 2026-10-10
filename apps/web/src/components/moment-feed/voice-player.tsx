"use client";

import { Mic } from "lucide-react";

/**
 * 语音动态回放（moment-card 内与图片网格并排）：
 * - <audio controls> 自带手势播放（iOS/安卓同源 cookie 鉴权天然可用），preload=none 避免列表批量拉音频
 * - PC 限宽 320px；移动端全宽、原生控件高度 40px 触控友好
 */
export default function VoicePlayer({ storageKey }: { storageKey: string }) {
  return (
    <div className="mt-2 flex w-full items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2 sm:w-[320px]">
      <Mic size={14} aria-hidden className="shrink-0 text-accent" />
      <audio controls preload="none" src={`/api/files/${storageKey}`} className="h-10 w-full min-w-0" />
    </div>
  );
}
