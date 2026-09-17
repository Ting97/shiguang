-- 005: Phase 2 W7 · 支付宝/微信 CSV 账单导入
-- 外部订单号去重：支付宝「交易订单号」/ 微信「交易单号」
-- 幂等：可重复执行

alter table transactions add column if not exists external_no text;

-- 同一用户内外部单号唯一（历史导入的手动/语音流水无单号，不受约束）
create unique index if not exists uq_tx_user_external_no
  on transactions (user_id, external_no)
  where external_no is not null;
