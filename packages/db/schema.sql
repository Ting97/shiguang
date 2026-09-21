-- ============================================================
-- 拾光 shiguangri · 数据库 Schema v1（Phase 0：时间日记模块先行）
-- 目标库：PostgreSQL 16+（Supabase 兼容）/ 含 pgvector 预留
-- 设计文档：docs/03-技术方案与架构设计.md §3
-- ============================================================

-- ---------- 用户（对接 Supabase auth.users 或自建 auth 时的用户表） ----------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),  -- = auth.users.id（Supabase 模式）
  nickname    text,
  timezone    text not null default 'Asia/Shanghai',
  -- 账户体系（migrations/002）：手机号+密码/验证码登录，微信扫码预留
  phone       text unique,                                 -- ^1[3-9]\d{9}$
  phone_verified boolean not null default false,
  password_hash  text,                                     -- scrypt，可空（纯验证码用户）
  wechat_openid  text unique,                              -- 预留：微信开放平台网站应用
  status      text not null default 'active',
  last_login_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 会话（migrations/002）：cookie 只放随机 token，库里存 sha256(token)
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,
  user_agent  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sessions_user on public.sessions (user_id, expires_at);

-- 短信验证码（migrations/002）
create table if not exists public.sms_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  purpose     text not null check (purpose in ('login','bind')),
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sms_phone on public.sms_codes (phone, created_at desc);

-- 邀请码（migrations/002）：一码一人
create table if not exists public.invite_codes (
  code        text primary key,
  created_by  uuid references public.profiles(id),
  used_by     uuid unique references public.profiles(id),
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- 饮食识别记录（migrations/008）：每动态一条，重识别覆盖
create table if not exists public.diet_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_id   uuid not null references public.entries(id) on delete cascade,
  meal       text not null default '未知' check (meal in ('早餐','午餐','晚餐','加餐','夜宵','未知')),
  items      jsonb not null default '[]',  -- [{name, amount?, kcal?}]
  total_kcal int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_diet_entry on public.diet_records (entry_id);

-- 五域识别登记簿（migrations/008）：applied/pending/none + 结果快照
create table if not exists public.entry_recognitions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_id   uuid not null references public.entries(id) on delete cascade,
  domain     text not null check (domain in ('schedule','todo','finance','mood','diet')),
  status     text not null default 'none' check (status in ('applied','pending','none')),
  result     jsonb not null default '{}',
  confidence real,
  engine     text not null default 'llm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_recog_entry_domain on public.entry_recognitions (entry_id, domain);

-- ---------- 时间模块（P0） ----------

-- 活动分类：预设 8 类 + 用户自定义
create table if not exists public.activities (
  id           text primary key,                    -- 'sleep' | 'work' | ... 用户自定义用 uuid
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,                       -- 睡眠/工作/学习/健身/社交/娱乐/家务/通勤
  icon         text not null default '⏱',
  color        text not null default '#64748b',     -- 时间块着色
  default_min  int not null default 30,             -- 无显式时长时的默认时长（分钟）
  sort_order   int not null default 0,
  is_preset    boolean not null default false,      -- 预设类不可物理删除
  created_at   timestamptz not null default now(),
  unique (user_id, name)
);

-- 原始记录：用户说的一句（语音转写文本 或 键入文本）——动态流的"动态"本体
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  source      text not null check (source in ('voice','keyboard','import','calendar_gap')),
  raw_text    text not null,                        -- 转写/键入原文
  audio_url   text,                                 -- 语音文件（OSS key，可空）
  mood        text,                                 -- AI 识别的心情词（开心/疲惫/焦虑…），null=未识别
  mood_score  int check (mood_score between -100 and 100),  -- 情绪强度：正=积极 负=消极
  created_at  timestamptz not null default now()
);
create index if not exists idx_entries_user_time on public.entries (user_id, created_at desc);

-- 语音日志：ASR 与解析过程留痕（错例反哺提示词的原料）
create table if not exists public.voice_logs (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.entries(id) on delete cascade,
  transcript   text,
  ai_parsed    jsonb,                               -- LLM 原始结构化输出
  confidence   real,
  status       text not null default 'pending' check (status in ('pending','parsed','confirmed','failed')),
  created_at   timestamptz not null default now()
);

-- 时间块：确认后生成（日历视图的数据源）
create table if not exists public.time_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  activity_id  text not null references public.activities(id),
  title        text not null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  duration_min int not null generated always as (ceil(extract(epoch from (end_at - start_at))/60)) stored,
  time_mode    text not null default 'default' check (time_mode in ('explicit','relative','default','manual')),
  source       text not null default 'voice' check (source in ('voice','keyboard','manual','import')),
  created_at   timestamptz not null default now(),
  check (end_at > start_at)
);
-- 待办：来自未来话术（"明天下午三点看牙"）或手动创建；完成时关联完成记录
create table if not exists public.todos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,   -- 来源话术
  title        text not null,
  activity_id  text references public.activities(id),
  due_at       timestamptz,                          -- 计划时间（解析引擎给出）
  start_at     timestamptz,                          -- 起始时间（进行中收尾待办/带区间计划；migrations/016）
  remind_at    timestamptz,                          -- 提醒时间（默认 due_at 前 15 分钟）
  status       text not null default 'pending' check (status in ('pending','done','skipped','expired')),
  source       text not null default 'voice' check (source in ('voice','keyboard','manual')),
  done_at      timestamptz,
  done_entry_id uuid references public.entries(id) on delete set null, -- 完成时的打卡记录
  done_block_id uuid references public.time_blocks(id) on delete set null, -- 完成时生成的时间块（恢复未完成时删除）
  parent_todo_id uuid references public.todos(id) on delete cascade, -- 子待办（仅一层，应用层校验；migrations/020）
  is_important boolean not null default false,                        -- ⭐ 重要（微软 To Do 式标记）
  today_tag_date date,                                                -- ☀️ 今日标记（=标记当天北京日期，跨零点惰性失效）
  created_at   timestamptz not null default now()
);
create index if not exists idx_todos_user_due on public.todos (user_id, due_at);
create index if not exists idx_todos_user_parent on public.todos (user_id, parent_todo_id);
create index if not exists idx_todos_user_today on public.todos (user_id, today_tag_date);
create index if not exists idx_todos_user_important on public.todos (user_id, is_important);

create index if not exists idx_blocks_user_range on public.time_blocks (user_id, start_at desc);

-- ---------- 跨域联动草稿（P0 先落库，Phase 2/3 接管确认流） ----------

-- 财务流水草稿：时间记录中被识别出金额的语句
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  direction    text not null default 'out' check (direction in ('out','in')),
  amount_cents int not null,                        -- 金额用分存整数，避免浮点
  category     text not null default '其他',         -- 餐饮/交通/人情往来/学习...
  account      text not null default '未指定',       -- Phase 2 完整账户体系
  counterparty text,                                -- 交易对象（可关联联系人名）
  note         text,
  occurred_at  timestamptz,
  source       text not null default 'voice' check (source in ('voice','keyboard','manual','csv_import')),
  is_draft     boolean not null default true,       -- P0 全部为草稿，Phase 2 确认流转正
  created_at   timestamptz not null default now()
);
create index if not exists idx_tx_user_time on public.transactions (user_id, occurred_at desc);

-- 联系人：语音中提到的人名自动建档（人际模块 Phase 3 接管完善）
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  alias       text,                                 -- "老王" 的本名等
  group_tag   text not null default '朋友',          -- 家人/朋友/同事/客户...
  birthday    date,
  birthday_cal text not null default 'solar' check (birthday_cal in ('solar', 'lunar')), -- 生日历法：solar=阳历（birthday） lunar=农历（lunar_*）
  lunar_month smallint check (lunar_month between 1 and 12), -- 农历月（birthday_cal='lunar' 时生效）
  lunar_day   smallint check (lunar_day between 1 and 30),   -- 农历日
  lunar_leap  boolean not null default false,                 -- 是否闰月生日
  intimacy    int not null default 50,              -- 亲密度 0~100（互动热度，自动累积）
  importance  smallint not null default 3 check (importance between 1 and 5), -- 重要程度五档：5=亲密 4=重要 3=普通 2=一般 1=简单（手动设定，决定图谱距离）
  notes       text,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- 人际往来事件草稿：送礼/吃饭/帮忙…（含金额，联动 transactions）
create table if not exists public.interactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  tx_id        uuid references public.transactions(id) on delete set null,  -- 关联流水（礼金等）
  type         text not null check (type in ('见面','通话','送礼','收礼','请客','帮忙','其他')),
  summary      text,
  occurred_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_inter_contact on public.interactions (contact_id, occurred_at desc);

-- ---------- AI 审计（成本核算与质量追踪） ----------
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  entry_id    uuid,
  stage       text not null,                        -- asr | parse | review | chat
  model       text not null,
  prompt_tokens    int not null default 0,
  completion_tokens int not null default 0,
  latency_ms  int,
  ok          boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- 预设数据：开发期单用户（后续接 Auth 后由注册流程创建） ----------
insert into public.profiles (id, nickname) values
  ('00000000-0000-0000-0000-000000000000', '开发者')
on conflict (id) do nothing;

-- 八大活动分类
insert into public.activities (id, user_id, name, icon, color, default_min, sort_order, is_preset) values
  ('sleep',  '00000000-0000-0000-0000-000000000000', '睡眠', '😴', '#6366f1', 480, 1, true),
  ('work',   '00000000-0000-0000-0000-000000000000', '工作', '💼', '#0ea5e9', 60, 2, true),
  ('study',  '00000000-0000-0000-0000-000000000000', '学习', '📚', '#10b981', 60, 3, true),
  ('fitness','00000000-0000-0000-0000-000000000000', '健身', '💪', '#f59e0b', 60, 4, true),
  ('social', '00000000-0000-0000-0000-000000000000', '社交', '👥', '#ec4899', 60, 5, true),
  ('fun',    '00000000-0000-0000-0000-000000000000', '娱乐', '🎮', '#8b5cf6', 30, 6, true),
  ('chores', '00000000-0000-0000-0000-000000000000', '家务', '🧹', '#84cc16', 60, 7, true),
  ('commute','00000000-0000-0000-0000-000000000000', '通勤', '🚌', '#78716c', 30, 8, true),
  ('other',  '00000000-0000-0000-0000-000000000000', '其他', '📌', '#64748b', 30, 9, true)
on conflict (id) do nothing;
