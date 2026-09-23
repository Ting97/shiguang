-- 038 · R3 每月备付追踪（REQ-005 FR-3.x）
-- 备付勾选：按月独立（ym=月首日）；随负债级联删除
create table if not exists public.debt_reserve_checks (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  ym           date not null,                     -- 月首日，如 2026-09-01
  liability_id uuid not null references public.liabilities(id) on delete cascade,
  checked_at   timestamptz not null default now(),
  primary key (user_id, ym, liability_id)
);

-- 储蓄账户参与备付覆盖统计标记（FR-3.3）
alter table public.accounts add column if not exists reserve_tracked boolean not null default false;
