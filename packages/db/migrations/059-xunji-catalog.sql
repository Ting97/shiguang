-- REQ-022：训记官方动作目录快照（单行缓存表）
-- 用途：佳明识别/计划落库前 AI 匹配动作名 + 同步训记校验；分层加载（内存 1h → 本表 7 天 → 外呼刷新写回）
-- movements: [{name, type, exetype, aliases:[...]}]（api_movement_catalog_for_llm_v2 规范化后的原始目录）
create table if not exists fitness_xunji_catalog (
  id int primary key default 1 check (id = 1),
  movements jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
