-- 040：微信小程序登录（docs/15 第 1 批）
-- profiles.wechat_openid 002 已预留（unique）；补 unionid（多端同主体打通）与头像。
alter table profiles
  add column if not exists wechat_unionid text unique,
  add column if not exists avatar_url text;

-- 绑定票据：jscode2session 成功但 openid 未绑定账号时签发，5 分钟一次性；
-- 库里只存 sha256（与会话 token/验证码同口径），消费即删行，过期行惰性清理
create table if not exists public.wechat_bind_tickets (
  ticket_hash text primary key,
  openid text not null,
  unionid text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_wechat_bind_tickets_exp on public.wechat_bind_tickets (expires_at);
