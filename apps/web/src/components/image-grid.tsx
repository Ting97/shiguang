"use client";

import { useEffect, useState } from "react";
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
        <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-faint">🖼 加载失败</span>
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

/** 全屏图片预览：左右切换 / Esc 与点遮罩关闭 */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCur((c) => (c - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setCur((c) => (c + 1) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (!images.length) return null;
  const img = images[cur];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim/95" onClick={onClose}>
      <img
        src={`/api/files/${img.storageKey}`}
        alt=""
        className="max-h-[88dvh] max-w-[92dvw] select-none rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setCur((c) => (c - 1 + images.length) % images.length); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-lg text-white backdrop-blur transition hover:bg-white/20"
            aria-label="上一张"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCur((c) => (c + 1) % images.length); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-lg text-white backdrop-blur transition hover:bg-white/20"
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
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  );
}
