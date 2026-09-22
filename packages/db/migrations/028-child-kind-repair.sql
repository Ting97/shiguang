-- 028 · 子行动 kind 数据修复（幂等）
-- 背景：027 上线后，POST /api/todos 带 parentId 新建子行动时 kind 落了默认 'todo'
--（kind 取值在 parentId 解析之前），导致：每日重复开关 400「每日重复仅支持行动」、
-- 今日清单 v2 / 空间行动完成率等按 kind='action' 的统计漏计。API 已修复，此处回填存量。
update todos
set kind = 'action'
where parent_todo_id is not null
  and kind <> 'action';
