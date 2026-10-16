-- REQ-023：用户确认的训记动作映射（拾光名 → 训记官方名）
-- 来源：同步训记遇目录外动作名时的确认弹窗（官方规则「不确定时让用户确认」）；
-- 确认后持久化，此后保存/同步自动套用，不再重复询问。
create table if not exists fitness_xunji_aliases (
  user_id uuid not null references profiles(id) on delete cascade,
  local_name text not null,
  official_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_name)
);
