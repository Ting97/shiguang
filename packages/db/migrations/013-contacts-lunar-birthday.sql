-- 013 · 人际模块：联系人生日支持农历
-- birthday_cal='lunar' 时生日由 lunar_month/lunar_day/lunar_leap 描述（birthday 置空）；
-- 闰月生日在无闰月年份按民间习俗回落平月（应用层换算）
-- 可重复执行
alter table public.contacts
  add column if not exists birthday_cal text not null default 'solar' check (birthday_cal in ('solar', 'lunar')),
  add column if not exists lunar_month smallint check (lunar_month between 1 and 12),
  add column if not exists lunar_day smallint check (lunar_day between 1 and 30),
  add column if not exists lunar_leap boolean not null default false;
