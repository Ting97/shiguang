-- 030: 应用级配置键值表（REQ-003：Jev 调用模式后台开关等）
-- 通用 key-value；value 为 JSONB。仅新增表，幂等，不影响既有数据与行为。
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
