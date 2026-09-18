-- 009 · 2026-09-19 发布秒存：先落动态再后台五域识别
-- analyzed_at 为空 = 尚未识别完成（前端显示「AI 识别中」）；识别结束（含失败）写时间戳
alter table public.entries add column if not exists analyzed_at timestamptz;
create index if not exists idx_entries_user_created on public.entries (user_id, created_at desc);
-- 存量动态在旧流程中是同步识别完成的，统一补标记
update public.entries set analyzed_at = coalesce(analyzed_at, created_at) where analyzed_at is null;
