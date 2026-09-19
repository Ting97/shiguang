-- 012 · 2026-09-19 复盘结果缓存：同一周期重复查看不再重复调 LLM（省 token、秒开）；「重新生成」强制刷新
create table if not exists public.review_caches (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('day','week','month','year')),
  period_key  text not null,                       -- day=YYYY-MM-DD · week=周一YYYY-MM-DD · month=YYYY-MM · year=YYYY
  review      jsonb not null,                      -- {summary, highlights[], suggestions[]}
  updated_at  timestamptz not null default now(),
  unique (user_id, kind, period_key)
);
