-- 052 · AI 对话助手（REQ-015 批次 A）：会话与消息表。
-- role 含 'tool'：预留工具调用轨迹消息；MVP 实际只落 user/assistant，
-- 工具轨迹存 assistant 行的 tool_calls JSONB（[{name,args}]），不单开 tool 行，避免重建消息链复杂度。
create table if not exists public.chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default '新对话',
  deleted_at  timestamptz,                           -- 软删（历史消息随会话隐藏，物理行保留审计追溯）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_chat_conv_user on public.chat_conversations (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,  -- 冗余属主：工具查询/越权过滤免 join
  role            text not null check (role in ('user','assistant','tool')),
  content         text not null default '',
  tool_calls      jsonb,                            -- assistant 行：[{name,args}] 查询轨迹（展示与审计用）
  created_at      timestamptz not null default now()
);
create index if not exists idx_chat_msg_conv on public.chat_messages (conversation_id, created_at);
create index if not exists idx_chat_msg_user_time on public.chat_messages (user_id, created_at desc);
