"use client";

import { ArrowLeft } from "lucide-react";

/** 模块未开通/已关闭态（REQ-003 3-F / REQ-028 泛化）：直连受控路由时的兜底展示（API 层已 403）。
 *  默认返回财务页（031 时代三个财务 tab 的原始语义）；其他域传 backHref/backLabel。 */
export default function ModuleLocked({
  title,
  desc,
  backHref = "/finance",
  backLabel = "返回财务概览",
}: {
  title: string;
  desc: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="glass mx-auto mt-10 max-w-sm rounded-2xl p-8 text-center">
      <p className="text-4xl">🔒</p>
      <h2 className="mt-3 text-base font-semibold text-ink">{title}未开通</h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-dim">{desc}</p>
      <a
        href={backHref}
        className="mt-5 inline-flex items-center gap-1 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-medium text-accent transition hover:bg-sky-500/20"
      >
        <ArrowLeft size={12} aria-hidden /> {backLabel}
      </a>
    </div>
  );
}
