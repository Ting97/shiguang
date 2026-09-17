-- 003: activities 主键改复合 (id, user_id) —— 每个用户拥有独立的预设分类行
-- 背景：原 id 全局主键下预设分类只属于开发用户一行，注册流程无法为新用户播种
--       （分类页空白、环形图「未知」）。改复合主键后每个用户都有自己的九大预设，
--       time_blocks/todos 用 (activity_id, user_id) 复合外键保证同用户引用。
-- 注意：必须先改主键、再补齐缺失预设、最后建复合外键——
--       存量数据可能存在跨用户引用（旧外键只校验 id 存在），先补数据才能过约束。
-- 幂等：可重复执行。

begin;

-- 引用 activities(id) 的旧外键先摘除
alter table time_blocks drop constraint if exists time_blocks_activity_id_fkey;
alter table todos       drop constraint if exists todos_activity_id_fkey;

-- 主键改复合 (id, user_id)
do $$ begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'activities'::regclass and c.contype = 'p'
      and pg_get_constraintdef(c.oid) like '%(id, user_id)%'
  ) then
    alter table activities drop constraint activities_pkey;
    alter table activities add primary key (id, user_id);
  end if;
end $$;

-- 为每个用户补齐缺失的九大预设（修复跨用户引用 + 新用户开箱即用）
insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
select s.id, p.id, s.name, s.icon, s.color, s.default_min, s.sort_order, true
from profiles p
cross join (values
  ('sleep',   '睡眠', '😴', '#6366f1', 480, 1),
  ('work',    '工作', '💼', '#0ea5e9', 60,  2),
  ('study',   '学习', '📚', '#10b981', 60,  3),
  ('fitness', '健身', '💪', '#f59e0b', 60,  4),
  ('social',  '社交', '👥', '#ec4899', 60,  5),
  ('fun',     '娱乐', '🎮', '#8b5cf6', 30,  6),
  ('chores',  '家务', '🧹', '#84cc16', 60,  7),
  ('commute', '通勤', '🚌', '#78716c', 30,  8),
  ('other',   '其他', '📌', '#64748b', 30,  9)
) as s(id, name, icon, color, default_min, sort_order)
on conflict do nothing;

-- 复合外键：记录只能引用自己名下的分类（此时存量引用已可满足）
alter table time_blocks
  add constraint time_blocks_activity_id_fkey
  foreign key (activity_id, user_id) references activities (id, user_id);
alter table todos
  add constraint todos_activity_id_fkey
  foreign key (activity_id, user_id) references activities (id, user_id);

commit;
