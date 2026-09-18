-- 007 · 2026-09-18 人际图谱：联系人重要程度五档（5=亲密 4=重要 3=普通 2=一般 1=简单）
-- 与 0~100 亲密度（互动热度，自动累积）语义分离：重要程度由用户手动设定，决定图谱中与中心的距离
alter table public.contacts
  add column if not exists importance smallint not null default 3;
alter table public.contacts
  add constraint contacts_importance_range check (importance between 1 and 5) not valid;
alter table public.contacts
  validate constraint contacts_importance_range;
