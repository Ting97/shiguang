-- 001 · 2026-09-17 动态流改造：entries 表增加心情字段
-- 背景：记录 = 登记一条动态，AI 识别意图（心情 / 历史日程 / 未来TODO）
alter table public.entries
  add column if not exists mood text,
  add column if not exists mood_score int check (mood_score between -100 and 100);

create index if not exists idx_entries_user_time on public.entries (user_id, created_at desc);
