-- 045: 动态流关键词检索 trgm 索引（REQ-009 FR-F5）：
-- listFeed 的 q 检索主列 e.raw_text 走 ilike '%kw%'（前后通配 B-tree 不可用），数据量增长后逐用户全扫；
-- 子表 exists 分支由 entry_id 索引驱动、行数小无需另建。pg_trgm gin 让 %kw% 走位图扫描。
create extension if not exists pg_trgm;
create index if not exists idx_entries_raw_text_trgm on public.entries using gin (raw_text gin_trgm_ops);
