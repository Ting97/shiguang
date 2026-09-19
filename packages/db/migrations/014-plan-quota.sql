-- 014 · 套餐与配额（M3 商业化地基）
-- plan: free（默认，30 天窗口内 AI 识别限次）| pro（无限，plan_expires_at 到期回落 free）
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists plan_expires_at timestamptz;
