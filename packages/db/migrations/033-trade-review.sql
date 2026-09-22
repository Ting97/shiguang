-- 033: 交易复盘（REQ-003 3-F FR-C2.7）—— 复用 review_caches / review_gen_quotas 两表，扩 kind 枚举
alter table public.review_caches drop constraint if exists review_caches_kind_check;
alter table public.review_caches add constraint review_caches_kind_check
  check (kind in ('day','week','month','year','trade_week'));
alter table public.review_gen_quotas drop constraint if exists review_gen_quotas_kind_check;
alter table public.review_gen_quotas add constraint review_gen_quotas_kind_check
  check (kind in ('day','week','month','year','trade_week'));
