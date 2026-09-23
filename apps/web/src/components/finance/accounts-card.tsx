/** 财务页账户卡（004 4-G 自 page.tsx 拆出）：账户余额一览 + 管理入口 */
"use client";

import { TagChip } from "@/components/tag-chip";
import { type Account, fmtMoney } from "./kit";

export function AccountsCard({ accounts, onManage }: { accounts: Account[]; onManage: () => void }) {
  return (
    <section className="glass mb-4 rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <TagChip icon="💳" label="账户" tone="sky" />
          <span className="text-xs font-normal text-ink-dim">
            合计 {fmtMoney(accounts.reduce((s, a) => s + a.balanceCents, 0))}
          </span>
        </h2>
        <button onClick={onManage} className="text-xs text-ink-mute hover:text-accent">
          管理
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-xl border border-line-soft bg-bg/40 px-3 py-2.5 text-center">
            <p className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-base leading-none">{a.icon}</p>
            <p className="truncate text-[11px] text-ink-mute">{a.name}</p>
            {a.balanceCents < 0 ? (
              <p className="text-sm font-semibold tabular-nums text-danger" title="余额为负——流水大于期初，点「管理」调整期初余额">
                {fmtMoney(a.balanceCents)} ⚠
              </p>
            ) : (
              <p className="text-sm font-semibold tabular-nums text-ink">{fmtMoney(a.balanceCents)}</p>
            )}
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="col-span-full py-3 text-center text-xs text-ink-faint">
            还没有账户 —— 点「管理」添加现金/支付宝等
          </p>
        )}
      </div>
    </section>
  );
}
