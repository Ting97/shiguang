-- 065: 补齐用户可触达删除路径的 FK 索引
-- 背景：PG 外键不自动建索引——删动态（entries 级联 voice_logs）/ 删时间块（todos.done_block_id
-- set null）/ 删流水（interactions.tx_id set null）/ 删计划（fitness_session_logs.plan_id 级联）
-- 都会对子表全表扫。039 当年为四张老表补过同类索引，053 之后的新表没跟进（十三轮补齐）。
-- space_id 两列为可空、且查询总带 user_id，用部分索引（仅非空行）省空间。
create index if not exists idx_voice_logs_entry on public.voice_logs (entry_id);
create index if not exists idx_todos_done_entry on public.todos (done_entry_id);
create index if not exists idx_todos_done_block on public.todos (done_block_id);
create index if not exists idx_interactions_tx on public.interactions (tx_id);
create index if not exists idx_fitness_session_logs_entry on public.fitness_session_logs (entry_id);
create index if not exists idx_fitness_session_logs_plan on public.fitness_session_logs (plan_id);
create index if not exists idx_entries_space on public.entries (space_id) where space_id is not null;
create index if not exists idx_todos_space on public.todos (space_id) where space_id is not null;
