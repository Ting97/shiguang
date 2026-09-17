-- 004: Phase 2 财务模块 v1（docs/04 · W6 + W8 精简）
-- 账户体系 + 月度预算（单行配置） + 流水关联账户

-- 账户：现金/支付宝/微信/银行卡… 余额 = 期初 + Σ已确认流水
create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  icon                text not null default '💳',
  opening_balance_cents bigint not null default 0,   -- 期初余额（分）
  sort_order          int not null default 0,
  archived            boolean not null default false, -- 归档不删除（历史流水保留）
  created_at          timestamptz not null default now(),
  unique (user_id, name)
);

-- 月度总上限（每用户一行配置；docs/03 §2 budgets 简化版）
create table if not exists public.budgets (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  monthly_limit_cents bigint not null default 0,     -- 0 = 未设置
  alert_threshold int not null default 80 check (alert_threshold between 1 and 100),
  updated_at     timestamptz not null default now()
);

-- 流水挂账户（新用户确认草稿时选择；存量草稿 account text 兜底显示）
alter table transactions add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- 草稿确认流转正常用：草稿查询高频
create index if not exists idx_tx_user_draft on public.transactions (user_id, is_draft, occurred_at desc);

-- 老用户开箱即用：为没有任何账户的用户播种四个常用账户
insert into accounts (user_id, name, icon, sort_order)
select p.id, s.name, s.icon, s.sort_order
from profiles p
cross join (values
  ('现金',   '💵', 1),
  ('支付宝', '🅰',  2),
  ('微信',   '💬',  3),
  ('银行卡', '💳',  4)
) as s(name, icon, sort_order)
where not exists (select 1 from accounts x where x.user_id = p.id);
