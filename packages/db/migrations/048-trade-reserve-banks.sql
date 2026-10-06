-- 048: trade 备付镜像表（scripts/ops/sync-debt-from-trade.mjs 每日重建）
-- 与 trade「每月备付追踪」页逐行同源：银行合并行 + 需还矩阵（月供/到期本金/当月需还）+ 账户剩余（备付金额）。
-- members：该行覆盖的 shiguang 负债 id（由编码映射反查），备付页据此把已镜像负债从手写清单中隐藏。
create table if not exists trade_reserve_banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  ym date not null,
  seq int not null default 0,
  bank text not null,
  prios text not null default '',
  parts jsonb not null default '[]',
  pay_days text not null default '',
  pay_cents bigint not null default 0,
  extra_cents bigint not null default 0,
  need_cents bigint not null default 0,
  saved_cents bigint,
  members uuid[] not null default '{}',
  synced_at timestamptz not null default now(),
  unique (user_id, ym, bank)
);
create index if not exists idx_trade_reserve_banks_user_ym on trade_reserve_banks (user_id, ym);
