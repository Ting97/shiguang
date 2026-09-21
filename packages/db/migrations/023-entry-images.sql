-- 023: 动态图片（REQ-001 R1）：entry_images 独立表（entries 不加列，避免 jsonb 行膨胀）
-- storage_key 形如 "2026/09/<uuid>.jpg"，写入 UPLOAD_DIR（生产 /opt/shiguangri_data/uploads，发布交换目录之外）
-- 访问统一走 /api/files/<storage_key>（登录 + 属主校验，key 为 uuid 不可枚举）
create table if not exists public.entry_images (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  entry_id    uuid not null references public.entries(id) on delete cascade,
  storage_key text not null unique,
  mime        text not null,
  bytes       int not null,
  width       int,
  height      int,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_entry_images_entry on public.entry_images (entry_id, sort);
