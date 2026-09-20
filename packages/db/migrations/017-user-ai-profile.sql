-- 用户 AI 画像（复盘记忆层）：随使用积累的习惯/偏好/规律，注入复盘提示词让 AI 越用越懂用户
-- profile 条目形状：{ text, period, source }，由月报生成后的合并调用维护，总量上限约 40 条
create table if not exists public.user_ai_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  profile jsonb not null default '{"habits":[],"preferences":[],"patterns":[],"facts":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
