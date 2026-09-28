-- 042：Bitget 多密钥/多 CFD 账号支持（docs/16）。
-- 一个拾光用户可绑定多把 Bitget 只读 key（主账号/子账号各一把），按 label 区分；
-- 每把 key 同步到各自的交易账号（trade_accounts.login），互不混数据。
alter table user_exchange_keys drop constraint user_exchange_keys_pkey;
alter table user_exchange_keys add column label text not null default '默认';
alter table user_exchange_keys add primary key (user_id, exchange, label);
