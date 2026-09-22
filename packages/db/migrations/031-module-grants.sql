-- 031: 模块级授权（REQ-003 3-F FR-C2.1）
-- admin 默认全模块可用；可授权指定用户使用指定模块（首期 debt 负债管理 / trade_review 交易复盘）。
-- 前端按 me.modules 控制 tab 可见性，API 层用 getModuleUser 双层门禁。（文档原编号 030，因 030 被 app-config 占用顺延）
create table if not exists public.user_module_grants (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  module      text not null check (module in ('debt','trade_review')),
  granted_by  uuid references public.profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, module)
);
