-- 051: transactions 补 updated_at 列 —— 复盘缓存水位（review-ctx buildLatest 两档 + finance review week）
-- 依赖 `max(updated_at)` 识别「编辑金额/草稿转正后需失效」，但该列从未在 schema/迁移中创建：
-- 全新部署水位查询 42703 → 复盘 500；靠库外漂移存在列的环境恒 NULL → 编辑后水位不抬，
-- day/week/month 复盘与交易周报在下一次新增流水前一直回旧金额。
-- 本迁移补齐列；写入侧由 transactions/[id] PATCH 同步 `updated_at = now()`（唯一 UPDATE 路径）。
alter table public.transactions add column if not exists updated_at timestamptz not null default now();
