-- 056 · 内置置顶「运动」目标空间（REQ-018）：健身功能并入空间体系。
-- kind：null=用户自建；'sport'=内置运动模板（每用户至多一个，partial unique）。
-- 存量「运动/健身」自建空间：todos/entries/space_reflections 三表 space_id 改指内置空间后删除旧空间。
alter table public.goal_spaces add column if not exists kind text;
create unique index if not exists uq_goal_spaces_sport on public.goal_spaces (user_id) where kind = 'sport';

-- 每用户创建内置运动空间（幂等：唯一部分索引 + on conflict do nothing；系统空间不占 20 个用户配额）
insert into public.goal_spaces (user_id, name, icon, kind, sort, description)
select p.id, '运动', '🏃', 'sport', -1, '内置训练空间：计划 · 打卡 · 趋势，兼有 TODO·行动 / 感悟 / 动态'
from public.profiles p
on conflict (user_id) where kind = 'sport' do nothing;

-- 存量迁移（1/4）：待办与行动
update public.todos t set space_id = ns.id
from public.goal_spaces old, public.goal_spaces ns
where t.space_id = old.id and old.kind is null and old.name in ('运动', '健身')
  and ns.user_id = old.user_id and ns.kind = 'sport';

-- 存量迁移（2/4）：动态
update public.entries e set space_id = ns.id
from public.goal_spaces old, public.goal_spaces ns
where e.space_id = old.id and old.kind is null and old.name in ('运动', '健身')
  and ns.user_id = old.user_id and ns.kind = 'sport';

-- 存量迁移（3/4）：感悟
update public.space_reflections r set space_id = ns.id
from public.goal_spaces old, public.goal_spaces ns
where r.space_id = old.id and old.kind is null and old.name in ('运动', '健身')
  and ns.user_id = old.user_id and ns.kind = 'sport';

-- 存量迁移（4/4）：删除已腾空的旧空间（kind is null 守卫保证重跑幂等；外键 set null/cascade 均不会被触发——数据已改指）
delete from public.goal_spaces old
where old.kind is null and old.name in ('运动', '健身')
  and exists (select 1 from public.goal_spaces ns where ns.user_id = old.user_id and ns.kind = 'sport');
