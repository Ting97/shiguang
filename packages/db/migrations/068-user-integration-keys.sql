-- REQ-042：每用户外部集成凭据（首用：训记 Open API key）。
-- api key 整体 AES-256-GCM 加密落库（EXCHANGE_ENC_KEY，与 user_exchange_keys 同格式），
-- 明文永不入库不入日志；(user_id, provider) 主键为后续集成（openGym 配对 token 等）留位
create table if not exists public.user_integration_keys (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  provider    text not null,
  api_key_enc text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);
