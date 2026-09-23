-- 039 · 检视修复：feed/清写路径性能索引 + 会话过期索引
-- 背景（007 全仓检视）：listFeed 每行 6+ 个按 entry_id 的相关子查询、确认/删除/识别清写路径的
-- delete where entry_id 全部无索引支撑（time_blocks/todos/transactions/interactions 四表）；
-- contacts 列表人情净额按 counterparty 关联、巡检扫 analyzed_at is null 也全表扫。
--
-- 注：「一个时刻只做一件事」的 EXCLUDE gist 约束（防 findOverlap 先查后插 TOCTOU）需要
-- btree_gist 扩展——生产 PG13 未装 postgresql-contrib，留待 contrib 就绪后另起编号；
-- 应用层 findOverlap 预检（409 文案）与 mapBlockWriteError 的 23P01 兜底保持不变。

-- feed 关联/清写路径
create index if not exists idx_time_blocks_entry on public.time_blocks (entry_id);
create index if not exists idx_todos_entry on public.todos (entry_id);
create index if not exists idx_transactions_entry on public.transactions (entry_id);
create index if not exists idx_interactions_entry on public.interactions (entry_id);
create index if not exists idx_transactions_account on public.transactions (account_id);

-- 联系人列表人情净额（transactions 按 user+counterparty 关联，且只统计已入账流水）
create index if not exists idx_tx_user_counterparty
  on public.transactions (user_id, counterparty) where is_draft = false;

-- contacts 全域按 user_id 过滤（列表/图谱/导出/reminders）
create index if not exists idx_contacts_user on public.contacts (user_id);

-- 识别巡检：where analyzed_at is null and created_at < now() - interval 部分索引
create index if not exists idx_entries_pending_analysis
  on public.entries (created_at) where analyzed_at is null;

-- 会话过期清理（巡检 tick 顺带 delete where expires_at < now()）
create index if not exists idx_sessions_expiry on public.sessions (expires_at);

-- 复盘按 user_id 聚合往来
create index if not exists idx_interactions_user_time on public.interactions (user_id, occurred_at);

-- 001 的 idx_entries_user_time 与 009 的 idx_entries_user_created 列完全一致（user_id, created_at desc），
-- 双倍写放大：保留前者，去掉后者
drop index if exists public.idx_entries_user_created;
