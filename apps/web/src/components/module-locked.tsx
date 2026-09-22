"use client";

/** 模块未开通态（REQ-003 3-F）：直连未授权路由时的兜底展示（API 层已 403） */
export default function ModuleLocked({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="glass mx-auto mt-10 max-w-sm rounded-2xl p-8 text-center">
      <p className="text-4xl">🔒</p>
      <h2 className="mt-3 text-base font-semibold text-ink">{title}未开通</h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-dim">{desc}</p>
      <a
        href="/finance"
        className="mt-5 inline-block rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-medium text-accent transition hover:bg-sky-500/20"
      >
        ← 返回财务概览
      </a>
    </div>
  );
}
