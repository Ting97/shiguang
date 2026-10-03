-- 043: 移动端推送 token（REQ-009 9-D）：expo-notifications 注册的设备推送令牌，
-- 巡检器每日提醒扫描（生日/久未联系/到期待办）经 Expo push API 投递。
-- token 全局唯一：一台设备同一时刻只属于一个账号（换号登录时 upsert 改属主）。
create table if not exists public.device_tokens (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  token        text not null unique,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_device_tokens_user on public.device_tokens (user_id, enabled);
