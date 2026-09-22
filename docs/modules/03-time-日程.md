# time · 日程模块

> 路径：`apps/api/src/server/time/` · 路由：`/api/blocks*` `/api/activities*` `/api/stats/range` · 表：time_blocks / activities

## 一、业务介绍

日程模块回答「我的时间花在哪了」。用户不必手动记账式地排日程——动态识别自动把已发生的事落上时间轴，缺口允许手动补录；日/周/月/年四视图日历呈现，并给出分类时长统计，让人看见自己的时间结构。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 自动落轴 | 动态里说「下午开了三小时会」，识别确认后自动生成时间块 | 时间块由 timeline 域识别编排写入（activity/title/start/end） |
| 手动补录 | 日视图点击空档自动定位整点，或「＋ 记一段」表单 | 活动分类来自本域 activities 表（九大预设+自定义） |
| 重叠保护 | 新块与已有块时间重叠 → 409 并返回冲突块信息（标题/时段），前端引导调整 | — |
| 拖拽/调整 | 日视图点击色块修改、表单内可调时间 | PATCH 强制 end>start 与重叠校验 |
| 四视图日历 | 日（时间轴+当日结构环）/周（七列网格）/月/年 | todo 视图叠加 goal 域待办；分类视图按 activities 聚合 |
| 时长统计 | /api/stats/range 按日×活动聚合分钟数 | 供日历统计区与复盘 facts（时间花销）消费 |
| AI 日小结 | 日视图「AI 小结」按钮 | 调 insight 域 review/day（消耗 AI 配额） |
| 预设活动 | 九大分类（sleep/work/study/fitness/social/fun/chores/commute/other）不可删除，新用户注册自动播种 | AI 识别的 activity 枚举与本表 id 一一对应 |

## 三、技术实现

### 数据模型
- `time_blocks`：user_id / entry_id（可空，识别来源）/ activity_id / title / start_at / end_at / time_mode（explicit/relative/default/future/manual）/ source
- 重叠检测：`tstzrange(start_at, end_at, '[)')` 与既有块 overlap 判定——**端点相接允许**（14:00 结束与 14:00 开始不冲突）
- `activities`：name / icon / color / default_min / is_preset

### 关键机制
- **语义时间校验**（QA 验收修复）：`isParsableMoment` 拒绝 T25:99 等非法时刻，`end > start` 强制前置校验——此前倒挂时间会触发 PG range 异常裸 500。
- **range 查询语义日期**：`isValidCalendarDate` 拒绝 2025-13-01 这类形状合法但不存在的日期。
- **跨天块按日分摊**：统计聚合对跨天时间块按日钳制（凌晨入睡的睡眠时段分别计入两天的统计）。

### 代码结构
```
server/time/
  service.ts  # createBlock/updateBlock/deleteBlock/listBlocksInRange/
              # listActivities/createActivity/updateActivity/deleteActivity/activityStatsInRange
  repo.ts     # blocksRepo / activitiesRepo / statsRepo（SQL 唯一发生地）
  seed.ts     # 九大预设活动播种（注册时调用）
index.ts      # 对外面
```
路由全部为 withAuth/withAuthParams 适配器；blocks 的 409 冲突响应由 service 组装（含 conflict 对象供前端定位）。
