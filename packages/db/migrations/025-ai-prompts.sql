-- 025: AI prompt 在线纳管（R4 /admin 后台）
-- ai_prompts: DB 覆盖值（enabled=false = 用代码默认值）；ai_prompt_versions: 每次保存的版本快照（可回滚）
-- 代码默认值注册表在 apps/api/src/lib/prompts.ts（packages/ai 保持纯包不感知 DB）
create table if not exists public.ai_prompts (
  key        text primary key,
  content    text not null,
  enabled    boolean not null default true,
  remark     text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_prompt_versions (
  id            bigint generated always as identity primary key,
  key           text not null,
  content       text not null,
  restored_from bigint,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_ai_prompt_versions_key on public.ai_prompt_versions (key, created_at desc);
