-- 032: 负债管理（REQ-003 3-F FR-C2.2 ~ FR-C2.6）
-- liabilities = 负债档案；liability_payments = 还款记录（余额应用层递减，不建快照表，曲线由 payments 推导）。
-- 金额统一 cents；利率存百分数（0~36）；亲友借款利率可为 0、月供可空。（文档原编号 031，顺延）
create table if not exists public.liabilities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  type            text not null check (type in ('credit_card','mortgage','car_loan','consumer_loan','bnpl','family')),
  principal_cents bigint not null check (principal_cents >= 0),   -- 原始本金
  balance_cents   bigint not null check (balance_cents >= 0),      -- 当前余额（还款后递减）
  rate_pct        numeric(5,2) not null default 0 check (rate_pct between 0 and 36),
  monthly_cents   bigint,                                          -- 月供（亲友借款可空）
  pay_day         int check (pay_day between 1 and 31),
  due_date        date,                                            -- 到期/结清日（先息后本=本金到期）
  priority        int not null default 0,                          -- 处置优先级
  note            text,
  status          text not null default 'active' check (status in ('active','cleared','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_liabilities_user on public.liabilities (user_id, status, priority);

create table if not exists public.liability_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  liability_id  uuid not null references public.liabilities(id) on delete cascade,
  amount_cents  bigint not null check (amount_cents > 0),
  paid_at       date not null,
  account_id    uuid references public.accounts(id) on delete set null,     -- 联动记支出的资产账户（可空）
  tx_id         uuid references public.transactions(id) on delete set null, -- 联动生成的流水
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_liability_payments_liab on public.liability_payments (liability_id, paid_at desc);
