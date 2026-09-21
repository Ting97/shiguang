-- 020: TODO 模块升级（微软 To Do 式）
-- 1) 子待办：parent_todo_id 自引用，仅一层（应用层校验：父待办自身不得再有 parent）
-- 2) 重要标记：is_important（对应微软 To Do 的 ⭐）
-- 3) 今日标记：today_tag_date = 标记当天的北京日期（对应「我的一天」）。
--    惰性清除：查询时比对 today_tag_date = 北京今天，跨零点自动失效，无需定时任务。
alter table public.todos add column if not exists parent_todo_id uuid references public.todos(id) on delete cascade;
alter table public.todos add column if not exists is_important boolean not null default false;
alter table public.todos add column if not exists today_tag_date date;

create index if not exists idx_todos_user_parent on public.todos (user_id, parent_todo_id);
create index if not exists idx_todos_user_today on public.todos (user_id, today_tag_date);
create index if not exists idx_todos_user_important on public.todos (user_id, is_important);
