-- REQ-025：睡眠记录扩展主观感受与 App 睡眠得分（均可选；教练排课时参考）
alter table public.fitness_sleep_logs
  add column if not exists feeling text check (feeling in ('good', 'ok', 'bad')),
  add column if not exists score int check (score between 0 and 100);
