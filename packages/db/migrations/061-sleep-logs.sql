-- REQ-024：睡眠独立记录（每日一条，移出训练打卡）
-- 睡眠是恢复信号（教练调整协议「睡眠<6h 降级」的数据源），不是训练产物；
-- source 标记录入渠道（manual=睡眠卡 / checkin=打卡兼容入参）。
create table if not exists fitness_sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  log_date date not null,
  sleep_h_x10 int not null check (sleep_h_x10 between 0 and 160),
  source text not null default 'manual' check (source in ('manual', 'checkin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);
create index if not exists idx_fitness_sleep_logs_user_date on fitness_sleep_logs (user_id, log_date desc);

-- 存量搬迁：打卡里已有的睡眠值作为起始数据（同日已有记录时以已有为准）
insert into fitness_sleep_logs (user_id, log_date, sleep_h_x10, source)
select user_id, log_date, sleep_h_x10, 'checkin'
from fitness_session_logs
where sleep_h_x10 is not null
on conflict (user_id, log_date) do nothing;
