-- 057 · 分域助手 + 空间阶段目标 + 身高指标（REQ-019）
-- 1) chat_conversations.scope：会话分域（global=全局拾光助手；goal/time/people/finance/fitness=域助手）
alter table public.chat_conversations add column if not exists scope text not null default 'global';
do $$ begin
  alter table public.chat_conversations add constraint ck_chat_conv_scope
    check (scope in ('global','goal','time','people','finance','fitness'));
exception when duplicate_object then null; end $$;
create index if not exists idx_chat_conv_user_scope on public.chat_conversations (user_id, scope, updated_at desc);

-- 2) space_milestones：空间阶段目标（历史列表，可多阶段并行进行）
create table if not exists public.space_milestones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  space_id     uuid not null references public.goal_spaces(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 80),
  target_date  date,
  status       text not null default 'active' check (status in ('active','done','abandoned')),
  completed_at timestamptz,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_space_milestones_space on public.space_milestones (space_id, status, sort);

-- 3) fitness_body_metrics.height_mm：身高时序（cm×10；体脂 body_fat_pct_x10 列 053 已建）
alter table public.fitness_body_metrics add column if not exists height_mm int;
do $$ begin
  alter table public.fitness_body_metrics add constraint ck_body_metrics_height
    check (height_mm is null or height_mm between 500 and 2500);
exception when duplicate_object then null; end $$;
