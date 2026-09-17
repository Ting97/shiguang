-- 006 · 人际模块：contacts 增加纪念日（生日字段已有）
-- 可重复执行
alter table public.contacts add column if not exists anniversary date;
