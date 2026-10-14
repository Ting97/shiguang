-- 055 · 训记（SynFit）Open API 集成（REQ-017）：计划双写的同步状态列。
-- localids 持久化训记 train 级 localid——同一天重复同步走更新（官方规则：更新必须保留
-- localid/start/end；不带 localid 为新建），杜绝「二次同步重复建训练」（life/fitness/xunji-api.md 踩坑 1）。
alter table public.fitness_daily_plans add column if not exists xunji_sync jsonb;
comment on column public.fitness_daily_plans.xunji_sync is '训记同步状态 {localids:[train localid...], syncedAt:北京 ISO}；null=未同步过';
