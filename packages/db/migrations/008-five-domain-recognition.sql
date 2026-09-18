-- 008 · 2026-09-18 动态五域识别：饮食卡路里 + 识别登记簿
-- 设计：docs/06 §8（五域独立判定 + 置信度分层：<0.6 存 pending 待用户确认，不自动落库）

-- 饮食识别记录（每条动态最多一条，重识别覆盖）
create table if not exists public.diet_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_id   uuid not null references public.entries(id) on delete cascade,
  meal       text not null default '未知' check (meal in ('早餐','午餐','晚餐','加餐','夜宵','未知')),
  items      jsonb not null default '[]',  -- [{name, amount?, kcal?}]，kcal 可空 = 估不出
  total_kcal int,                          -- 已知项合计；全未知为 null
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_diet_entry on public.diet_records (entry_id);

-- 五域识别登记簿：每次识别/重识别的结果快照（applied=已落库 pending=低置信待确认 none=判定无）
create table if not exists public.entry_recognitions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_id   uuid not null references public.entries(id) on delete cascade,
  domain     text not null check (domain in ('schedule','todo','finance','mood','diet')),
  status     text not null default 'none' check (status in ('applied','pending','none')),
  result     jsonb not null default '{}',  -- 域特定结果（pending 时为待确认的完整结果）
  confidence real,
  engine     text not null default 'llm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_recog_entry_domain on public.entry_recognitions (entry_id, domain);
