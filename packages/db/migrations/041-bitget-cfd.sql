-- 041 · Bitget UTA CFD 接入交易复盘（docs/16 调研结论）
-- 1) Bitget orderId 为长数字串（可能超 int8 上限 9.22e18）→ ticket 改 text（类型拓宽，MT5 存量无损）
alter table public.trades alter column ticket type text using ticket::text;

-- 2) 账户来源区分（既有行隐含 MT5）
alter table public.trade_accounts add column if not exists source text not null default 'mt5';
alter table public.trade_accounts drop constraint if exists trade_accounts_source_check;
alter table public.trade_accounts add constraint trade_accounts_source_check
  check (source in ('mt5', 'bitget'));

alter table public.trade_imports drop constraint if exists trade_imports_source_check;
alter table public.trade_imports add constraint trade_imports_source_check
  check (source in ('mt5_xlsx', 'csv', 'bitget_api'));

-- 3) 交易所 API 凭据（只读 key）：secret/passphrase AES-256-GCM 加密落库（EXCHANGE_ENC_KEY），
--    明文永不入库不入日志；(user_id, exchange) 主键为未来多交易所留位
create table if not exists public.user_exchange_keys (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  exchange      text not null default 'bitget',
  api_key       text not null,
  api_secret_enc text not null,
  passphrase_enc text not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, exchange)
);
