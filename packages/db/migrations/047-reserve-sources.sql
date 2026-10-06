-- 047: 每月备付资金来源行（REQ-009 滚动）：trade 备付页的"资金来源"行（储蓄卡/投机帐户/公积金/工资等）
-- 不是负债、无法挂 liabilities 外键，独立成表与负债行（debt_reserve_checks.planned_cents）并列展示
create table if not exists public.debt_reserve_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ym date not null,
  name text not null,
  planned_cents bigint not null default 0,
  source text not null default 'trade',
  created_at timestamptz not null default now(),
  unique (user_id, ym, name)
);
