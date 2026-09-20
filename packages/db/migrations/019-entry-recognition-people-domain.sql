-- 修复：entry_recognitions.domain 约束缺 people（识别菜单已支持人物单域重识别，
-- 但落库违反约束导致 500 回滚）。补入 people。
alter table public.entry_recognitions drop constraint entry_recognitions_domain_check;
alter table public.entry_recognitions add constraint entry_recognitions_domain_check
  check (domain = any (array['schedule'::text, 'todo'::text, 'finance'::text, 'mood'::text, 'diet'::text, 'people'::text]));
