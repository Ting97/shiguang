# goal · 目标模块

> 路径：`apps/api/src/server/goal/` · 路由：`/api/todos*` `/api/spaces*` · 表：todos / goal_spaces / space_reflections

## 一、业务介绍

目标模块把「想做的事」分成两层：**TODO**（有明确时限的事，如「周三前交周报」）与**行动**（TODO 拆出的、一次专注可完成的具体步骤，如「列提纲」）。再往上，**目标空间**为一个大目标（考研上岸、副业过万）提供专属容器——把相关的 TODO·行动、阶段感悟、相关动态聚在一个地方，见证每天的靠近。

设计哲学：**完成比完美重要**。todo 可以标今日、标重要、每天重复；行动必须是动词开头、单一产出、可判定的下一步；空间不是项目管理器，而是给坚持一个看得见的容器（第 N 天、完成率、目标倒计时）。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| TODO | 日程页 todo 视图或空间详情添加；支持截止时间（自动提前 15 分钟提醒）、每日重复、重要标记 | 识别自动态的 todo 自动继承动态的 space_id；工作台「今日行动」聚合 today 标记 |
| 行动 | todo 卡片「💡 拆解」：AI 自动拆出行动清单，或手动回车添加 | AI 拆解走 ai 域 todo_decompose/action_decompose 管线；已有行动作为去重清单注入 prompt |
| 完成与恢复 | 勾选完成（记 done_at），误触可恢复；重复完成的完成率不会重复计数 | 完成数据进空间完成率、复盘 facts |
| 每日重复 | repeatDaily 的 todo 每天自动恢复为待办（日切恢复） | 时间口径统一北京时间（EFF_TODAY 惰性日切） |
| 目标空间 | 新建（名称/描述/图标/颜色/开始/目标日期，进行中上限 20 个）；详情页三 tab：TODO·行动 / 感悟 / 动态 | 相关**动态自动归属**（AI 空间分类）；归属动态产生的 todo 自动继承空间 |
| 关联已有 | 空间详情「🔗 关联已有」浮层：把未归属的 TODO/行动挂进空间 | 动态流卡片也可手动归属/移除空间 |
| 感悟 | 阶段心情、复盘、自我对话（≤500 字长文），可编辑（显示 edited 标记） | 感悟列表倒序，total/字数预览 |
| 到期倒计时 | 空间头部显示目标日期与「第 N 天」 | — |

## 三、技术实现

### 数据模型
- `todos`：title / parent_todo_id（null=TODO，非空=行动）/ kind（todo/action）/ status（pending/done + done_at）/ due_at / start_at / remind_at / repeat_daily / important / today_flag / sort（拖拽排序锚点）/ space_id / activity_id / entry_id（识别来源）
- `goal_spaces`：name(≤40) / description / icon / color / started_at / target_date / status（active/archived，active 上限 20）/ sort
- `space_reflections`：space_id / content(≤500) / created_at / updated_at（edited 标记）

### 关键机制
- **日切恢复（EFF_TODAY）**：repeatDaily todo 的完成记录按「有效今天」判断——北京时间惰性日切，昨天完成的今天自动回到待办（restoreRepeating 在列表读取时惰性执行，无需定时任务）。
- **行动约束**：行动不可标重要/设重复（400）；顶层 todo 不可设 repeatDaily 为行动语义——层级语义由 service 层强制。
- **排序稳定性**：拖拽换位取相邻 sort 中值（sortAnchor/shiftSortAfter），避免全量重排。
- **完成防重**：重复 done 返回 404（幂等防护），undone 仅对已完成有效。

### 代码结构
```
server/goal/
  service.ts  # todoService.list/create/update/remove、spaceService.*、reflectionService.*
              # updateTodo 内部分发 undone（事务）/done（防重计数）/字段修改三模式
  repo.ts     # todoRepo（22 个方法）/ spaceRepo / reflectionRepo——SQL 唯一发生地
index.ts      # 对外面：export * from service
```
路由（todos 3 个 + spaces 4 个）全部为 withAuth/withAuthParams 适配器 ≤25 行；decompose 为 AI 编排壳（withAuth + 配额），引用 ai 域管线。
