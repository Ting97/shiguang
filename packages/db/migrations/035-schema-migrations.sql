-- 035: 迁移记录表（REQ-004 FR-A3 / 4-A）：migration runner 自举——此后增量迁移由 `npm run db:migrate` 执行。
-- 首跑时 runner 会把已存在的 001~034 按文件名序回填为本表记录（applied_by='backfill'），此后只执行未记录的增量。
create table if not exists public.schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now(),
  checksum   text,
  applied_by text not null default 'runner'
);
