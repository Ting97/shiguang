-- 002 · N6 行动解耦：行动成为一等公民，可无父独立存在（todo 与行动父子关系变为可选）
-- 行形态：顶层 todo = kind 'todo' + 无父；todo 的行动 = 'action' + 有父；独立行动（新增）= 'action' + 无父

alter table public.todos add column if not exists kind text not null default 'todo';

-- 存量回填：现有子待办即行动（幂等）
update public.todos set kind = 'action'
 where parent_todo_id is not null and kind <> 'action';

-- 约束（幂等：先删后建）
alter table public.todos drop constraint if exists todos_kind_check;
alter table public.todos add constraint todos_kind_check check (kind in ('todo', 'action'));

create index if not exists idx_todos_user_kind on public.todos (user_id, kind);
