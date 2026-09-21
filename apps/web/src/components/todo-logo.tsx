"use client";

import { useId } from "react";

/**
 * TODO 模块 logo：「拾光勾」——渐变 squircle 容器 + 单笔圆头勾 + 四芒星光（拾光 motif）。
 * 渐变与全站 sky→indigo 一致；勾是待办品类的通用符号（Microsoft To Do / Todoist 同语言）。
 * onGradient：放在渐变底（如日程页激活 tab）上时切换为白玻璃反转变体，避免渐变叠渐变。
 * useId 保证多实例渐变 id 不冲突。
 */
export default function TodoLogo({ size = 20, onGradient = false }: { size?: number; onGradient?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `tl-g${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="inline-block shrink-0 align-[-0.18em]"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {onGradient ? (
        <>
          <rect x="2" y="2" width="44" height="44" rx="13" fill="rgba(255,255,255,.16)" />
          <rect x="2.75" y="2.75" width="42.5" height="42.5" rx="12.3" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="1.6" />
          <path d="M13.5 25.5 L21.5 33 L34.5 15.5" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.5 25.5 L21.5 33 L34.5 15.5" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M38.6 6.2 l1.35 3.35 3.35 1.35 -3.35 1.35 -1.35 3.35 -1.35 -3.35 -3.35 -1.35 3.35 -1.35 z" fill="#fff" opacity=".95" />
        </>
      ) : (
        <>
          <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gid})`} />
          <rect x="2.75" y="2.75" width="42.5" height="42.5" rx="12.3" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" />
          <path d="M13.5 25.5 L21.5 33 L34.5 15.5" fill="none" stroke="rgba(15,23,42,.18)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.5 25.5 L21.5 33 L34.5 15.5" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M38.6 6.2 l1.35 3.35 3.35 1.35 -3.35 1.35 -1.35 3.35 -1.35 -3.35 -3.35 -1.35 3.35 -1.35 z" fill="#fff" opacity=".95" />
        </>
      )}
    </svg>
  );
}
