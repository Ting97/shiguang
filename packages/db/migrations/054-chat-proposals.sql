-- 054 · 助手操作意图确认卡登记簿（REQ-016，落地 REQ-015 规划的 A.5 机制）。
-- 助手提案只写本表（pending）；用户在卡片上点「保存」后由前端调业务域既有 API，
-- 成功再回写 accepted——助手永不静默写业务数据。kind 首发 fitness_plan，后续域复用。
create table if not exists public.chat_proposals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete cascade,
  kind            text not null check (kind in ('fitness_plan')),
  payload         jsonb not null default '{}',
  status          text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_chat_proposals_conv on public.chat_proposals (conversation_id, created_at desc);
create index if not exists idx_chat_proposals_user_status on public.chat_proposals (user_id, status, created_at desc);
