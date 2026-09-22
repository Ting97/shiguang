-- 029: AI 输入装配管理（REQ-003 3-A）——扩展 025 两表
-- ai_prompts 加 user 模板覆盖 + 注入配置（均 null = 代码默认，向后兼容存量行）；
-- ai_prompt_versions 升级三件套快照 payload（content 保留兼容旧版本，回滚优先 payload）。
-- 纯加列、幂等；上线即刻零行为变化（新列为 null → 代码默认）。
alter table public.ai_prompts add column if not exists user_template text;
alter table public.ai_prompts add column if not exists context_config jsonb;

alter table public.ai_prompt_versions add column if not exists payload jsonb;
