-- 064: 聊天日配额原子占位表
-- 背景：free 对话 10 次/北京日的门禁原为 check-then-act（读 audit_logs 计数放行，
-- 调用完成后才落 ok=true 审计），并发发 N 条消息全部读到同一计数可无限超限。
-- 修复口径与 review_gen_quotas 一致：调用前原子占位（used+1 where used < lim），
-- 失败时回退占位；audit_logs 仍为计费/审计事实源，本表只服务配额判定与今日已用展示。
create table if not exists public.chat_daily_quotas (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day_key    text not null,                -- 北京日 YYYY-MM-DD（占位时刻的北京日历日）
  used       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key)
);
