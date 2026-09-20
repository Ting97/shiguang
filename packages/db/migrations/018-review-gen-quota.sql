-- 复盘生成次数管控（review v3.1）：每个 (用户, 周期类型, 周期键) 独立一池
-- 上限（累计生成次数）：日 2 / 周 5 / 月 10 / 年 24；初始给满，实际可用受时间解锁约束
-- 时间解锁（北京时间，晚 8 点）：当日 20:00 前留 1 次；当前周周日晚 20:00 前留 2 次（可用3）；
--   当月逐周 +2（周一为周界）；当年逐月 +2。历史周期全开。管理员不限。
-- bonus：周期内数据有更新时 +1 的加成，可用 = min(上限, 时间解锁 + bonus) - used，不提前解锁日/周预留份额
create table if not exists public.review_gen_quotas (
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('day','week','month','year')),
  period_key text not null,
  bonus int not null default 0,
  used int not null default 0,
  last_data_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);
