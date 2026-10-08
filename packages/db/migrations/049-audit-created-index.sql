-- 049: audit_logs 留存清扫索引：patrol 每 5 分钟 `delete from audit_logs where created_at < now() - interval '180 days'`
-- 无 user_id 谓词，走不了 011 的 idx_audit_user_time (user_id, created_at desc)（前导列不匹配 → 顺序全表扫）。
-- 补独立 (created_at) 索引让清扫走范围扫描；写入侧仅每行多一份索引维护，量级可接受。
create index if not exists idx_audit_logs_created on public.audit_logs (created_at);
