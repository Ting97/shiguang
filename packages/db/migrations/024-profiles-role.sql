-- 024: 管理员角色（R4 后台管理基础）
-- role: user=普通用户 / admin=超级管理员；存量开发账号（DEV_USER_ID）迁移为 admin。
-- 此前管理员判断散落 11 处 `id === DEV_USER_ID` 硬编码，统一收编为本字段。
alter table public.profiles add column if not exists role text not null default 'user';

-- 约束用 do 块保证幂等（列已存在但约束缺失时也能补上）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles add constraint profiles_role_check check (role in ('user','admin'));
  end if;
end $$;

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000000';
