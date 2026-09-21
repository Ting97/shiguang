-- 022: 目标空间（REQ-001 R3 · P0）
-- goal_spaces：宏大目标容器（≥1 年）；entries/todos 挂 space_id（删除空间置空，不删业务数据）
-- 行动模型（v1.1）：行动 = 子待办（仅一层，现状约束不动）；新增 sort（插入式拆解）、
--   repeat_daily（每日重复）、repeat_done_count（已完成次数）、last_done_date（06:00 记录日界）
create table if not exists public.goal_spaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  description text,
  icon        text not null default '🎯',
  color       text not null default '#38bdf8',
  status      text not null default 'active' check (status in ('active','archived')),
  started_at  date,
  target_date date,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_goal_spaces_user on public.goal_spaces (user_id, status, sort);

alter table public.entries add column if not exists space_id uuid references public.goal_spaces(id) on delete set null;
alter table public.todos  add column if not exists space_id uuid references public.goal_spaces(id) on delete set null;
create index if not exists idx_entries_user_space on public.entries (user_id, space_id, created_at desc);
create index if not exists idx_todos_user_space  on public.todos  (user_id, space_id);

-- todos.source 增加 'ai'（AI 拆解产物）
alter table public.todos drop constraint if exists todos_source_check;
alter table public.todos add constraint todos_source_check
  check (source in ('voice','keyboard','manual','ai'));

-- 行动有序排列 + 每日重复 + 已完成次数
alter table public.todos add column if not exists sort              int not null default 0;
alter table public.todos add column if not exists repeat_daily      boolean not null default false;
alter table public.todos add column if not exists repeat_done_count int not null default 0;
alter table public.todos add column if not exists last_done_date    date;
create index if not exists idx_todos_parent_sort on public.todos (parent_todo_id, sort);

-- 排序回填：存量子任务按创建顺序编号（幂等：重复执行重排结果一致）
update todos t set sort = s.rn
from (select id, row_number() over (partition by parent_todo_id order by created_at) as rn
      from todos where parent_todo_id is not null) s
where t.id = s.id;

-- 存量行动空间继承回填（幂等）：行动的 space_id 跟随父待办
update todos a set space_id = p.space_id
from todos p
where a.parent_todo_id = p.id and a.space_id is null and p.space_id is not null;
