-- 034: 登录防护（REQ-004 FR-C1 / 4-B）：登录尝试台账 + 账号锁定持久层。
-- 内存滑动窗口（IP 维度，单机假设）+ 本表（身份维度 20 次失败锁 30 分钟）双层防护。
create table if not exists public.login_attempts (
  id         bigserial primary key,
  identity   text not null,            -- 手机号或邮箱（小写归一）
  ip         text,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_identity_time
  on public.login_attempts (identity, created_at desc);
