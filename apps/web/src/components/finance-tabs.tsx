"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FilterChip } from "./tag-chip";
import { api } from "@/shared/api";

/**
 * 财务二级 tab（REQ-003 3-F FR-C2.8）：概览 | 负债 | 交易复盘。
 * 负债/交易复盘按 me.modules 条件渲染（未授权不渲染入口，直连路由由 API 403 + 页面「未开通」态兜底）。
 * 三个路由共用：/finance、/finance/debt、/finance/review。
 */
export default function FinanceTabs() {
  const pathname = usePathname();
  const [modules, setModules] = useState<string[] | null>(null);

  useEffect(() => {
    api<{ modules?: string[] }>("/api/auth/me")
      .then((j) => j.modules ?? [])
      .then(setModules)
      .catch(() => setModules([]));
  }, []);

  const has = (m: string) => modules?.includes(m) ?? false;

  return (
    <nav className="mb-5 flex justify-center" aria-label="财务二级导航">
      <div className="inline-flex rounded-full border border-line-soft bg-surface/70 p-1">
        <Link href="/finance">
          <FilterChip label="概览" icon="📊" active={pathname === "/finance"} variant="pill" />
        </Link>
        {has("debt") && (
          <Link href="/finance/debt">
            <FilterChip label="负债" icon="🏦" active={pathname === "/finance/debt"} variant="pill" />
          </Link>
        )}
        {has("trade_review") && (
          <Link href="/finance/review">
            <FilterChip label="交易复盘" icon="📈" active={pathname === "/finance/review"} variant="pill" />
          </Link>
        )}
      </div>
    </nav>
  );
}
