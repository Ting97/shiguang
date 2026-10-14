-- 053 · 健身模块（REQ-016）：模块/目标/每日计划/执行记录/身体指标/动作库 + todos 今日行动联动锚点。
-- 单位纪律：距离 m、时长/配速 s（秒每公里）、体重 g、腰围 mm、体脂×10、睡眠小时×10，全部整数。
-- 计划为中心：计划三来源（ai/import/manual）→ 确认 → 自动联动 todos（fitness_plan_id）→ 打卡。

-- 训练模块目录（数据驱动可扩展：加行即扩模块）
create table if not exists public.fitness_modules (
  code      text primary key,
  name      text not null,
  icon      text not null default '🏃',
  sort      int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.fitness_modules (code, name, icon, sort, is_active) values
  ('run', '跑步', '🏃', 10, true),
  ('strength', '力量', '🏋️', 20, true)
on conflict (code) do nothing;

-- 基本情况档案（「用户情况」：AI 生成计划的输入之一）
create table if not exists public.fitness_profiles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  height_cm  int check (height_cm between 50 and 260),
  baseline   jsonb not null default '{}',   -- {weightG, bodyFatPctX10, measuredOn}
  experience text,
  equipment  jsonb not null default '[]',
  weekly_days text,
  constraints text,                          -- 伤病/约束（SQL 关键字面列名，应用层引用加引号）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 目标：每模块至多一条活跃；strategy=阶段/周模板/动态调整协议/饮食目标（AI 编排依据）
create table if not exists public.fitness_goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  module_code text not null references public.fitness_modules(code),
  title       text not null,
  target_date date,
  status      text not null default 'active' check (status in ('active','achieved','archived')),
  targets     jsonb not null default '{}',   -- {finishTimeS} / {weightG:[min,max], bodyFatPctX10:[min,max]}
  baseline    jsonb not null default '{}',
  strategy    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists idx_fitness_goals_active on public.fitness_goals (user_id, module_code) where status = 'active';
create index if not exists idx_fitness_goals_user on public.fitness_goals (user_id, status);

-- 每日计划：一天一模块一条（draft→confirmed→done/partial/skipped）
create table if not exists public.fitness_daily_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  plan_date   date not null,
  module_code text not null references public.fitness_modules(code),
  source      text not null check (source in ('ai','import','manual')),
  status      text not null default 'draft' check (status in ('draft','confirmed','done','partial','skipped')),
  content     jsonb not null default '{}',   -- 跑步:{workoutType,title,segments,totalDistanceM,durationMin,note} 力量:{title,exercises:[…]}
  rationale   text,
  origin_conversation_id uuid references public.chat_conversations(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, plan_date, module_code)
);
create index if not exists idx_fitness_plans_user_date on public.fitness_daily_plans (user_id, plan_date desc);

-- 执行记录（打卡产物；entry_id 预留二期一句话识别接入）
create table if not exists public.fitness_session_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  log_date    date not null,
  module_code text not null references public.fitness_modules(code),
  plan_id     uuid references public.fitness_daily_plans(id) on delete set null,
  actual      jsonb not null default '{}',   -- 跑步:{distanceM,durationS,paceSPerKm,avgHr} 力量:{exercises:[{name,sets,reps,weightG}]}
  fatigue     int check (fatigue between 1 and 10),
  sleep_h_x10 int check (sleep_h_x10 between 0 and 160),
  soreness    text,
  note        text,
  entry_id    uuid references public.entries(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_fitness_logs_user_date on public.fitness_session_logs (user_id, log_date desc);

-- 身体指标（周一晨起空腹口径：体重/腰围/体脂/静息心率）
create table if not exists public.fitness_body_metrics (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  measured_on      date not null,
  weight_g         int check (weight_g between 20000 and 300000),
  waist_mm         int check (waist_mm between 300 and 2000),
  body_fat_pct_x10 int check (body_fat_pct_x10 between 30 and 600),
  resting_hr       int check (resting_hr between 30 and 130),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, measured_on)
);

-- 动作库（全局种子）：主/副肌群 + benefit（练什么对哪里有好处）+ 默认组次模板
create table if not exists public.fitness_exercises (
  id                text primary key,
  module_code       text not null references public.fitness_modules(code),
  name              text not null,
  muscle_primary    jsonb not null default '[]',
  muscle_secondary  jsonb not null default '[]',
  equipment         text,
  level             text not null default 'beginner' check (level in ('beginner','intermediate','advanced')),
  benefit           text not null default '',
  default_template  jsonb not null default '{}',
  sort              int not null default 0
);
insert into public.fitness_exercises (id, module_code, name, muscle_primary, muscle_secondary, equipment, level, benefit, default_template, sort) values
  ('goblet_squat','strength','高脚杯深蹲','["股四头肌","臀肌"]','["核心"]','哑铃','beginner','下肢入门复合动作：蹲得深、护腰背，顺带练核心稳定，新手学深蹲的第一步','{"sets":3,"reps":"10-12","rir":3}',10),
  ('leg_press','strength','腿举','["股四头肌","臀肌"]','[]','器械','beginner','器械下肢课：腰背压力小，跑步期低量保腿力的选择','{"sets":2,"reps":"10-15","rir":3}',20),
  ('split_squat','strength','分腿蹲','["股四头肌","臀肌"]','["平衡稳定"]','自重/哑铃','beginner','单腿发力纠正左右不均衡，跑者腿力的功能性动作','{"sets":2,"reps":"10-12/侧","rir":3}',30),
  ('glute_bridge','strength','臀桥','["臀肌"]','["腘绳肌"]','自重','beginner','唤醒臀肌、缓解久坐腰酸，跑者防膝痛的打底动作','{"sets":2,"reps":15}',40),
  ('squat_bb','strength','杠铃深蹲','["股四头肌","臀肌"]','["核心","竖脊肌"]','杠铃','intermediate','四大项之一：全身协调发展，阶段 B 下肢进阶的主项','{"sets":3,"reps":"5-8","rir":2}',50),
  ('bench_press_db','strength','哑铃卧推','["胸大肌"]','["三角肌前束","肱三头肌"]','哑铃','beginner','胸厚度主项：哑铃行程自由、左右均衡，新手优先于杠铃','{"sets":3,"reps":"8-12","rir":3}',60),
  ('bench_press_bb','strength','杠铃卧推','["胸大肌"]','["三角肌前束","肱三头肌"]','杠铃','intermediate','上肢力量标杆：胸厚度与推力的进阶主项','{"sets":3,"reps":"8-12","rir":2}',70),
  ('chest_fly','strength','器械夹胸','["胸大肌"]','[]','器械','beginner','孤立练胸中缝，给胸部线条收尾','{"sets":2,"reps":"12-15","rir":2}',80),
  ('shoulder_press_db','strength','哑铃肩推','["三角肌"]','["肱三头肌","上胸"]','哑铃','beginner','肩部推力主项：肩宽与挺拔体态的根基','{"sets":2,"reps":"10-12","rir":3}',90),
  ('lateral_raise','strength','侧平举','["三角肌中束"]','[]','哑铃','beginner','肩宽第一视觉：薄肌审美「穿衣显瘦」的核心动作，每练必有','{"sets":2,"reps":"12-15","rir":2}',100),
  ('face_pull','strength','面拉','["三角肌后束","上背"]','[]','绳索','beginner','改善圆肩驼背、肩关节健康，伏案族必练','{"sets":2,"reps":15}',110),
  ('seated_row','strength','坐姿划船','["中背","背阔肌"]','["肱二头肌"]','器械','beginner','背部厚度入门：器械轨迹稳，新手练背第一站','{"sets":3,"reps":"10-12","rir":3}',120),
  ('lat_pulldown','strength','高位下拉','["背阔肌"]','["肱二头肌"]','器械','beginner','背宽度主项：V 字躯干、显腰细，引体前的过渡','{"sets":3,"reps":"10-12","rir":3}',130),
  ('db_row_single','strength','单臂哑铃划船','["背阔肌"]','["肱二头肌"]','哑铃','beginner','单侧背厚度：行程长、可自查不对称','{"sets":3,"reps":"10-12/侧","rir":3}',140),
  ('pullup','strength','引体向上（辅助）','["背阔肌"]','["肱二头肌","前臂"]','单杠/辅助带','intermediate','背宽与相对力量的金标准，辅助带渐进','{"sets":3,"reps":"3-8","rir":2}',150),
  ('rdl','strength','罗马尼亚硬拉','["腘绳肌","臀肌"]','["竖脊肌"]','杠铃/哑铃','intermediate','后链与髋铰链：护腰、提臀、跑步伸髋力量的来源','{"sets":2,"reps":"10-12","rir":3}',160),
  ('deadlift','strength','杠铃硬拉','["全身后链"]','["背","臀","腿"]','杠铃','intermediate','四大项之一：全身力量之王，阶段 B 恢复完整进阶','{"sets":3,"reps":"5-8","rir":2}',170),
  ('tricep_pushdown','strength','绳索下压','["肱三头肌"]','[]','绳索','beginner','手臂后侧线条：推类动作的辅助补强','{"sets":2,"reps":"12-15","rir":2}',180),
  ('bicep_curl','strength','哑铃弯举','["肱二头肌"]','["前臂"]','哑铃','beginner','手臂前侧线条：薄肌「有线条不夸张」的小补项','{"sets":2,"reps":"12-15","rir":2}',190),
  ('calf_raise','strength','提踵','["小腿三头肌"]','[]','自重/器械','beginner','小腿线条，跑步提踵经济性的小补项','{"sets":2,"reps":15}',200),
  ('pushup','strength','俯卧撑（变式）','["胸大肌"]','["三角肌","肱三头肌"]','自重','beginner','居家/旅行保底推类：标准-上斜-下斜渐进','{"sets":2,"reps":"力竭-2"}',210),
  ('plank','strength','平板支撑','["核心"]','[]','垫上','beginner','核心抗伸展稳定：一切力量与跑姿的地基','{"sets":3,"reps":"30-45s"}',220),
  ('dead_bug','strength','死虫式','["深层核心"]','[]','垫上','beginner','腰腹稳定且零脊柱压力，核心日打底动作','{"sets":3,"reps":"10/侧"}',230),
  ('crunch','strength','卷腹','["腹直肌"]','[]','垫上','beginner','腹肌线条：体脂降下来才看得见，配合减脂','{"sets":3,"reps":"12-15"}',240),
  ('hanging_leg_raise','strength','悬挂举腿','["下腹","髂腰肌"]','["前臂握力"]','单杠','intermediate','下腹线条进阶，顺带练握力','{"sets":3,"reps":"10-15"}',250),
  ('run_interval','run','间歇跑','["心肺","最大摄氧量"]','["速度"]','跑步','intermediate','提升最大摄氧量（VO2max），半马破 2 的核心强度课','{"durationMin":40}',310),
  ('run_tempo','run','节奏跑','["乳酸阈值"]','["比赛配速"]','跑步','intermediate','提升乳酸阈值与比赛配速耐受，练 5''41"/km 的体感','{"durationMin":40}',320),
  ('run_long','run','长距离跑','["有氧耐力","肌耐力"]','[]','跑步','beginner','打有氧底子与肌耐力，破 2 的基石；也是力量课要避让的对象','{"durationMin":90}',330),
  ('run_easy','run','轻松跑','["有氧基础"]','["恢复"]','跑步','beginner','低强度积累有氧里程，能正常说话的配速','{"durationMin":40}',340),
  ('run_recovery','run','恢复跑','["主动恢复"]','[]','跑步','beginner','最轻量的活动恢复，心率 1 区，比完全躺更有利于次日状态','{"durationMin":30}',350)
on conflict (id) do nothing;

-- todos 联动锚点：计划存在且未 skipped → 今日行动始终与计划同步（on delete cascade：计划行删除连带行动）
alter table public.todos add column if not exists fitness_plan_id uuid;
alter table public.todos drop constraint if exists todos_fitness_plan_id_fkey;
alter table public.todos add constraint todos_fitness_plan_id_fkey
  foreign key (fitness_plan_id) references public.fitness_daily_plans(id) on delete cascade;
create index if not exists idx_todos_fitness_plan on public.todos (fitness_plan_id) where fitness_plan_id is not null;
