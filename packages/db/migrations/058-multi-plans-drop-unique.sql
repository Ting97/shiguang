-- 058 · 训练计划多计划并存（REQ-021）
-- 一天同模块允许多条计划（晨/晚两练、误导入重存）：去掉 (user_id, plan_date, module_code) 唯一约束。
-- 约束名已在生产库核实（053 建表内联 unique 的 Postgres 自动命名）。
alter table public.fitness_daily_plans
  drop constraint if exists fitness_daily_plans_user_id_plan_date_module_code_key;
