-- 016: 待办补起始时间（进行中的事 → 待办带 [start_at, due_at] 区间）
-- 场景：「今天9:10到9:30工作准备」在 9:20 记录时已开始未结束，
--       除日程块外生成收尾待办；待办需要保留起始时刻，前端展示为区间。
alter table public.todos add column if not exists start_at timestamptz;
