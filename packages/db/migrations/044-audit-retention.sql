-- 044: 审计留存与汇总（REQ-009 FR-F1）：audit_logs 是全站唯一 AI 计费口径且无任何清理，
-- 每条动态 parse+space_classify+review 可写 5-10 行，单调无限增长。
-- 策略：明细保留 180 天；清理前按 用户×月×stage×模型×engine 上卷进月度汇总表（永久保留），
-- 配额判定（quota 只看 30 天窗口）与成本报表（读汇总）不受影响。
create table if not exists public.audit_logs_monthly (
  id bigserial primary key,
  user_id uuid not null,
  month date not null,                -- 该月第一天（北京时间口径按 created_at+08 截断，与业务时区一致）
  stage text not null,
  model text not null default '',
  engine text not null default '',
  calls int not null default 0,
  ok_calls int not null default 0,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  unique (user_id, month, stage, model, engine)
);
create index if not exists idx_audit_monthly_user_time on public.audit_logs_monthly (user_id, month desc);
