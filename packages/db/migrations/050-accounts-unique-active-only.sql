-- 账户同名唯一约束改为「仅未归档行」：DELETE /api/accounts/:id 是软归档（archived=true），
-- 旧全行唯一约束让「删除后重建同名」撞 23505，而归档行在任何列表都不可见（UI 死路）。
-- 归档行保留历史流水归属（transactions.account_id on delete set null），名字随归档释放。
alter table public.accounts drop constraint if exists accounts_user_id_name_key;
create unique index if not exists accounts_user_id_name_active_uidx
  on public.accounts (user_id, name) where archived = false;
