-- 063: 功能插件化三层模块开关（REQ-028）
-- 三层状态（写主体不同，分三表）：全局层（管理员）→ 按用户层（管理员）→ 用户自选层（用户）。
-- module 列不设值域 CHECK、不 FK：注册表在代码（packages/shared/src/modules.ts），
-- 写入路径一律先过 zod（key ∈ registry）；新模块演进零迁移。

-- 全局层：管理员维护每模块全局开关与「允许用户自开关」默认覆盖（空=注册表默认兜底）
create table if not exists public.module_states (
  module          text primary key,
  enabled         boolean not null,
  user_toggleable boolean not null,
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);

-- 按用户层：管理员强制态 + 该用户开关可见性（均可空=跟随上层）
create table if not exists public.user_module_controls (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  module         text not null,
  force_state    text check (force_state in ('on','off')),
  switch_visible boolean,
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  primary key (user_id, module)
);

-- 用户自选层：【我的】→功能管理 的开关值
create table if not exists public.user_module_prefs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  module     text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

-- 存量搬迁：031/037 既有授权 → 按用户强制开（幂等，可重放）。
-- user_module_grants 此后保留停写（读取/写入全部改走 user_module_controls）。
insert into public.user_module_controls (user_id, module, force_state, switch_visible, updated_by)
select g.user_id, g.module, 'on', null, g.granted_by
from public.user_module_grants g
on conflict (user_id, module) do nothing;
