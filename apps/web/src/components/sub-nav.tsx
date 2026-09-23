"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FilterChip } from "./tag-chip";

export interface SubNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 路由模式：给 href 走 Link（finance-tabs）；不给走受控 onChange（schedule 子页切换） */
  href?: string;
}

/**
 * 公共二级子导航（REQ-005 FR-4.3）：居中胶囊容器 `bg-surface/70 p-1` + pill chip，
 * 统一 finance/schedule 等模块子导航视觉。两种模式：
 * - 受控：value + onChange（schedule 子页切换，keep-alive 由页面自己保证）
 * - 路由：item.href（finance-tabs 薄封装，Link 跳转）
 */
export default function SubNav({
  items,
  value,
  onChange,
  ariaLabel = "子导航",
  className = "",
}: {
  items: SubNavItem[];
  value?: string;
  onChange?: (key: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav className={`flex justify-center ${className}`} aria-label={ariaLabel}>
      <div className="inline-flex rounded-full border border-line-soft bg-surface/70 p-1">
        {items.map((it) =>
          it.href ? (
            <Link key={it.key} href={it.href}>
              <FilterChip label={it.label} icon={it.icon} active={value === it.key} variant="pill" />
            </Link>
          ) : (
            <FilterChip
              key={it.key}
              label={it.label}
              icon={it.icon}
              active={value === it.key}
              variant="pill"
              onClick={() => onChange?.(it.key)}
            />
          ),
        )}
      </div>
    </nav>
  );
}
