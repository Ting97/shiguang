"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedImage } from "@/lib/types";

/**
 * 动态卡九宫格（REQ-001 R1）：1 张大图 / 2-3 张横排 / 4-9 张 3 列网格。
 * 懒加载 + 失败占位；点击进入全屏预览（ImageLightbox，由父级渲染）。
 */
export function ImageGrid({ images, onOpen }: { images: FeedImage[]; onOpen?: (index: number) => void }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  if (!images.length) return null;
  const n = images.length;

  const cell = (img: FeedImage, i: number, cls: string) => (
    <button
      key={img.id}
      onClick={() => !failed.has(img.id) && onOpen?.(i)}
      className={`group relative overflow-hidden rounded-xl bg-elevated ${cls}`}
    >
      {failed.has(img.id) ? (
        <span className="flex h-full w-full items-center justify-center text-badge text-ink-faint">🖼 加载失败</span>
      ) : (
        <img
          src={`/api/files/${img.storageKey}`}
          alt=""
          loading="lazy"
          onError={() => setFailed((s) => new Set(s).add(img.id))}
          className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
        />
      )}
    </button>
  );

  return (
    <div className="mt-2">
      {n === 1 ? (
        <div className="flex">{cell(images[0], 0, "aspect-[4/3] w-2/3 max-w-72")}</div>
      ) : n <= 3 ? (
        <div className="flex gap-1.5">{images.map((img, i) => cell(img, i, "aspect-square w-1/3 max-w-40"))}</div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">{images.map((img, i) => cell(img, i, "aspect-square"))}</div>
      )}
    </div>
  );
}

/**
 * 全屏图片预览（REQ-009 FR-B7）：触摸滑动切图 / 双击缩放（定位点击点）/ 键盘左右切换 /
 * 切换淡入过渡 / 邻图预加载 / Esc 与点遮罩关闭。
 */
export function ImageLightbox({
  images,
  index,
  onClose,
}: {
  images: FeedImage[];
  index: number;
  onClose: () => void;
}) {
  const [cur, setCur] = useState(index);
  const [zoom, setZoom] = useState(0); // 0=适应 1=放大 2.2x（origin 记在 zoomOrigin）
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const swipeX = useRef<number | null>(null);
  const lastTap = useRef(0);

  const go = (delta: number) => {
    setZoom(0);
    setCur((c) => (c + delta + images.length) % images.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose]);

  // 邻图预加载：切换零等待
  useEffect(() => {
    for (const d of [-1, 1]) {
      const neighbor = images[(cur + d + images.length) % images.length];
      if (neighbor) new window.Image().src = `/api/files/${neighbor.storageKey}`;
    }
  }, [cur, images]);

  if (!images.length) return null;
  const img = images[cur];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim/95"
      onClick={onClose}
      onPointerDown={(e) => (swipeX.current = e.clientX)}
      onPointerUp={(e) => {
        if (swipeX.current === null || zoom > 0) return;
        const dx = e.clientX - swipeX.current;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); // 左滑下一张，右滑上一张
        swipeX.current = null;
      }}
    >
      <img
        key={cur}
        src={`/api/files/${img.storageKey}`}
        alt=""
        draggable={false}
        className="page-in max-h-[88dvh] max-w-[92dvw] select-none rounded-lg object-contain transition-transform duration-base"
        style={zoom > 0 ? { transform: `scale(${zoom === 1 ? 2.2 : 1})`, transformOrigin: zoomOrigin } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // 双击缩放：300ms 内两次点击，以点击点为缩放原点；再双击复位
          const now = Date.now();
          if (now - lastTap.current < 300) {
            if (zoom === 0) {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              setZoomOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`);
              setZoom(1);
            } else {
              setZoom(0);
            }
            lastTap.current = 0;
          } else {
            lastTap.current = now;
          }
        }}
      />
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            className="tap-lg press absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-lg text-white backdrop-blur transition hover:bg-white/20"
            aria-label="上一张"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(1); }}
            className="tap-lg press absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-lg text-white backdrop-blur transition hover:bg-white/20"
            aria-label="下一张"
          >
            ›
          </button>
          <span className="absolute bottom-5 rounded-full bg-black/50 px-3 py-1 text-xs tabular-nums text-white">
            {cur + 1} / {images.length}
          </span>
        </>
      )}
      <button
        onClick={onClose}
        className="tap-lg absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  );
}
