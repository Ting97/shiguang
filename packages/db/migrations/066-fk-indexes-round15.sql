-- 066: 补齐无索引外键（十五轮检视，065 同口径续作——按 pg_constraint/pg_index 全库实测，非推测）
-- 背景：PG 外键不自动建索引。①用户可触达删除路径：删负债（debt_reserve_checks.liability_id 级联，
-- 其 PK 前缀 user_id,ym 盖不住）/ 删交易账号（trade_imports.account_id 级联）/ 删导入批次
-- （trades.import_id set null）/ 删会话（fitness_daily_plans.origin_conversation_id set null）/
-- 删流水或改挂账户（liability_payments.tx_id / account_id set null）都会对子表全表扫；
-- ②user_id 列（profiles 级联，管理端触达）：这些列同时也是几乎所有查询的首个过滤谓词，
-- 建索引对日常查询同样受益。
create index if not exists idx_debt_reserve_checks_liability on public.debt_reserve_checks (liability_id);
create index if not exists idx_trade_imports_account on public.trade_imports (account_id);
create index if not exists idx_trade_imports_user on public.trade_imports (user_id);
create index if not exists idx_trades_import on public.trades (import_id);
create index if not exists idx_fitness_daily_plans_origin_conversation on public.fitness_daily_plans (origin_conversation_id);
create index if not exists idx_liability_payments_tx on public.liability_payments (tx_id);
create index if not exists idx_liability_payments_account on public.liability_payments (account_id);
create index if not exists idx_liability_payments_user on public.liability_payments (user_id);
create index if not exists idx_diet_records_user on public.diet_records (user_id);
create index if not exists idx_entry_images_user on public.entry_images (user_id);
create index if not exists idx_entry_recognitions_user on public.entry_recognitions (user_id);
create index if not exists idx_space_milestones_user on public.space_milestones (user_id);
create index if not exists idx_space_reflections_user on public.space_reflections (user_id);
