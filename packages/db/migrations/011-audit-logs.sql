-- 011 · 2026-09-19 解析审计写入（docs/06 欠账：每次解析记录 引擎/模型/耗时 → audit_logs 成本监控）
-- schema.sql 早有旧版 audit_logs（stage/model/tokens/latency_ms），本地已建、生产没有 —— 本迁移幂等补齐两侧差异列，
-- 统一以旧设计为基准（stage 区分场景），增强 engine/text_len/error。
alter table public.audit_logs add column if not exists stage text;
alter table public.audit_logs add column if not exists model text;
alter table public.audit_logs add column if not exists prompt_tokens int not null default 0;
alter table public.audit_logs add column if not exists completion_tokens int not null default 0;
alter table public.audit_logs add column if not exists latency_ms int;
alter table public.audit_logs add column if not exists engine text;
alter table public.audit_logs add column if not exists text_len int;
alter table public.audit_logs add column if not exists error text;
create index if not exists idx_audit_user_time on public.audit_logs (user_id, created_at desc);
