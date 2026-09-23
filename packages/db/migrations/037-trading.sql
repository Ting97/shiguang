-- 037 · R1 MT5 投资交易（REQ-005 FR-1.x）
-- 零耦合边界：trades 不进 accounts/transactions；净资产口径不含交易账户

create table if not exists public.trade_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  login      text not null,                       -- MT5 账号
  nickname   text,                                -- 用户备注名
  currency   text not null default 'USD',
  created_at timestamptz not null default now(),
  unique (user_id, login)
);

create table if not exists public.trade_imports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.trade_accounts(id) on delete cascade,
  file_name  text not null,
  source     text not null check (source in ('mt5_xlsx','csv')),
  rows_total int not null default 0,
  rows_new   int not null default 0,
  rows_dup   int not null default 0,
  first_at   timestamptz, last_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  account_id  uuid not null references public.trade_accounts(id) on delete cascade,
  import_id   uuid references public.trade_imports(id) on delete set null,
  ticket      bigint not null,
  symbol      text not null default 'XAUUSD',
  direction   text not null check (direction in ('buy','sell')),
  open_time   timestamptz not null,
  close_time  timestamptz not null,
  lots        numeric(10,2) not null,
  open_price  numeric(12,5), close_price numeric(12,5),
  profit      numeric(12,2) not null default 0,
  commission  numeric(12,2) not null default 0,
  swap        numeric(12,2) not null default 0,
  net_profit  numeric(12,2) generated always as (profit + commission + swap) stored,
  unique (user_id, account_id, ticket)
);
create index if not exists idx_trades_acct_close on public.trades (account_id, close_time desc);
create index if not exists idx_trades_user_close on public.trades (user_id, close_time desc);

-- 模块枚举扩展（031 模式）
alter table public.user_module_grants drop constraint if exists user_module_grants_module_check;
alter table public.user_module_grants add constraint user_module_grants_module_check
  check (module in ('debt','trade_review','trading'));

-- AI 复盘：review 缓存/配额 kind 扩展（同 033 drop+add 模式）
alter table public.review_caches     drop constraint if exists review_caches_kind_check;
alter table public.review_caches     add constraint review_caches_kind_check
  check (kind in ('day','week','month','year','trade_week','trading'));
alter table public.review_gen_quotas drop constraint if exists review_gen_quotas_kind_check;
alter table public.review_gen_quotas add constraint review_gen_quotas_kind_check
  check (kind in ('day','week','month','year','trade_week','trading'));
