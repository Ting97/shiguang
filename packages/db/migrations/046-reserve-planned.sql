-- 046: 每月备付计划金额（REQ-009 滚动）：trade 每月备付追踪同步——
-- 每月×每笔负债的计划备付金额（trade 为源，source='trade'），勾选台账从纯布尔升级为带金额
alter table public.debt_reserve_checks
  add column if not exists planned_cents bigint,
  add column if not exists source text not null default 'manual';
