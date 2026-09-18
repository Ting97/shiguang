-- 010 · 2026-09-19 联系人 AI 交往画像（W10 遗留：喜好/忌讳提炼）
-- ai_profile: { summary, likes[], dislikes[], facts[] }；ai_profile_at 为生成时间（空=未生成过）
alter table public.contacts add column if not exists ai_profile jsonb;
alter table public.contacts add column if not exists ai_profile_at timestamptz;
