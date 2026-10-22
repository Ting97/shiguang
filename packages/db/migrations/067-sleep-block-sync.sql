-- REQ-038 睡眠自动同步日程：time_blocks 链接列 + 存量幂等回填
-- 链接范式与 syncPlanTodos（todos.fitness_plan_id）一致：睡眠日志按 (user_id, log_date) 稳定 upsert，
-- 行 id 天然作链接键；删除睡眠行级联清掉同步块。唯一部分索引保证一条睡眠至多一个同步块
--（运行时替换式同步先删后插，索引兜底并发/回填重跑）。
alter table public.time_blocks
  add column if not exists sleep_log_id uuid
  references public.fitness_sleep_logs (id) on delete cascade;

create unique index if not exists time_blocks_sleep_log_id_uq
  on public.time_blocks (sleep_log_id) where sleep_log_id is not null;

-- 存量回填（幂等，可重跑）：时长>0 且尚无对应块的睡眠日志，按「log_date 07:00 起床锚点（北京）」
-- 生成跨天块，区间 = [log_date 07:00 − 时长, log_date 07:00]；与既有日程重叠者跳过
--（与运行时冲突策略同口径：跳过不写入，下次保存可重试）；用户缺 sleep 预设分类时跳过。
-- 回填块 source/time_mode 均为 'manual'，与手动建块同构，靠 sleep_log_id 非空识别同步产物。
insert into public.time_blocks (user_id, activity_id, title, start_at, end_at, time_mode, source, sleep_log_id)
select l.user_id, 'sleep', '睡眠',
       ((l.log_date::timestamp + interval '07:00') - interval '1 hour' * (l.sleep_h_x10 / 10.0)) at time zone 'Asia/Shanghai',
       (l.log_date::timestamp + interval '07:00') at time zone 'Asia/Shanghai',
       'manual', 'manual', l.id
from public.fitness_sleep_logs l
where l.sleep_h_x10 > 0
  and not exists (select 1 from public.time_blocks b where b.sleep_log_id = l.id)
  and exists (select 1 from public.activities a where a.id = 'sleep' and a.user_id = l.user_id)
  and not exists (
    select 1 from public.time_blocks b
    where b.user_id = l.user_id
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(
            ((l.log_date::timestamp + interval '07:00') - interval '1 hour' * (l.sleep_h_x10 / 10.0)) at time zone 'Asia/Shanghai',
            (l.log_date::timestamp + interval '07:00') at time zone 'Asia/Shanghai', '[)'));
