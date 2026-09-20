-- 015 · 邮箱认证（登录注册支持邮箱）
alter table public.profiles add column if not exists email text unique;
alter table public.profiles add column if not exists email_verified boolean not null default false;

-- 邮箱验证码（与 sms_codes 同构）
create table if not exists public.email_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  purpose     text not null check (purpose in ('login','bind')),
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_email_codes_email on public.email_codes (email, created_at desc);
