-- 021: 子任务详情内容（微软 To Do 式备注）：列表只展示标题，点开看详情
-- note 由应用层校验长度（≤1000 字），留 text 类型
alter table public.todos add column if not exists note text;
