-- 002 · N2 空间感悟：空间内长文记录（纯文本，单篇 ≤50000 字），随空间级联删除

create table if not exists public.space_reflections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  space_id   uuid not null references public.goal_spaces(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_space_reflections_space on public.space_reflections (space_id, created_at desc);
