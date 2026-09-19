"use client";

/** 骨架屏加载占位（shimmer 微光），替代纯文本"加载中…" */
export default function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-16 rounded-2xl" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}
