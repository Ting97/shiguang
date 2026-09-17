-- 002 · 2026-09-17 用户账户体系：手机号+密码/验证码登录、会话、邀请码注册
-- 设计文档：docs/09-账户体系.md
-- 约定：/setup 创建的第一个管理员直接继承开发用户 UUID 00000000-…，存量数据零迁移

-- 用户表扩展（微信 openid 为扫码登录预留，需企业资质后才接入）
alter table public.profiles
  add column if not exists phone text unique,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists password_hash text,
  add column if not exists wechat_openid text unique,
  add column if not exists status text not null default 'active',
  add column if not exists last_login_at timestamptz;

-- 会话：cookie 只放随机 token，库里存 sha256(token)，可吊销、可扩展设备管理
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,
  user_agent  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sessions_user on public.sessions (user_id, expires_at);

-- 短信验证码：6 位数字存 hash，5 分钟有效，错 5 次作废
create table if not exists public.sms_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  purpose     text not null check (purpose in ('login','bind')),
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sms_phone on public.sms_codes (phone, created_at desc);

-- 邀请码：一码一人，管理员生成；开放注册将来只需加开关
create table if not exists public.invite_codes (
  code        text primary key,
  created_by  uuid references public.profiles(id),
  used_by     uuid unique references public.profiles(id),
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
