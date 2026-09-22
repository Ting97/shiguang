-- 036: 识别任务巡检补跑（REQ-004 FR-C2.4）：entries.analyze_retries 记录补跑次数，
-- 巡检扫 analyzed_at is null 且超时的动态（进程重启/识别崩溃丢失的任务）自动补跑，上限 3 次防风暴。
alter table public.entries add column if not exists analyze_retries int not null default 0;
