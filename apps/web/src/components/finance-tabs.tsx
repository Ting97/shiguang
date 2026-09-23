"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import SubNav, { type SubNavItem } from "./sub-nav";
import { api } from "@/shared/api";

/**
 * 财务二级 tab（REQ-003 3-F FR-C2.8；REQ-005 FR-4.4 更名 + R1 加交易）：概览 | 负债 | 收支复盘 | 交易。
 * 负债/收支复盘/交易按 me.modules 条件渲染（未授权不渲染入口，直连路由由 API 403 + 页面「未开通」态兜底）。
 * 路由：/finance、/finance/debt、/finance/review、/finance/trading。
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

  const items: SubNavItem[] = [
    { key: "/finance", label: "概览", icon: "📊", href: "/finance" },
    ...(has("debt") ? [{ key: "/finance/debt", label: "负债", icon: "🏦", href: "/finance/debt" }] : []),
    ...(has("trade_review") ? [{ key: "/finance/review", label: "收支复盘", icon: "📈", href: "/finance/review" }] : []),
    ...(has("trading") ? [{ key: "/finance/trading", label: "交易", icon: "🎯", href: "/finance/trading" }] : []),
  ];

  return <SubNav className="mb-5" ariaLabel="财务二级导航" items={items} value={pathname} />;
}
