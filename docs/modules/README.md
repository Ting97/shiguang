# 拾光 · 功能模块域说明文档

> 按九个领域模块组织的详细说明：业务介绍 / 功能与产品使用联动 / 技术实现方案。
> 代码位置对应：`apps/api/src/server/<域>/`（service/repo/index 三层）+ `apps/api/src/app/api/**`（薄适配路由）。
> 总览与全局架构见 [13-产品与架构总览.html](../13-产品与架构总览.html)。

## 阅读地图

一条主线贯穿全系统：**动态（timeline）是采集入口，确认流把识别产物写入四个业务域（time/goal/finance/people），反思层（insight）跨域聚合反哺用户，AI 内核（ai）与平台层（platform）支撑全局，身份（identity）守护入口。**

| 文档 | 模块 | 一句话定位 | 关键跨域联动 |
|---|---|---|---|
| [01-identity-身份与访问](01-identity-身份与访问.md) | identity | 邀请注册、双凭证登录、会话与登录防护 | me.modules 驱动财务 tab；全 API 鉴权底座 |
| [02-timeline-时光流](02-timeline-时光流.md) | timeline ★ | 一句话六维识别 + 确认流（核心域） | confirm 编排 time/goal/finance/people 四域写入 |
| [03-time-日程](03-time-日程.md) | time | 时间块、四视图日历、时长统计 | 识别自动落轴；统计供复盘 |
| [04-goal-目标](04-goal-目标.md) | goal | TODO·行动、目标空间、感悟、AI 拆解 | 动态归属使待办继承空间；AI 拆解行动 |
| [05-finance-财务](05-finance-财务.md) | finance | 账户/流水/预算/导入/报表 + 负债管理 + 交易复盘 | 识别自动记账；还款联动生成「还款」流水 |
| [06-people-人际](06-people-人际.md) | people | 联系人档案、往来、生日提醒、星型图谱、AI 画像 | 动态提到的人自动建档；人情账聚合自财务流水 |
| [07-insight-复盘与工作台](07-insight-复盘与工作台.md) | insight | 四级复盘、今日工作台、提醒、画像沉淀 | CQRS 读侧跨域聚合 18 表；画像反哺识别 |
| [08-ai-AI内核](08-ai-AI内核.md) | ai | 双引擎识别管线、Prompt 纳管、影子/接管、计量配额 | 被 timeline/goal/insight 消费；管理台全量可调 |
| [09-platform-平台](09-platform-平台.md) | platform | 邀请码、模块授权、套餐计费、文件、导出、健康检查 | 模块授权驱动财务 tab；邀请驱动注册 |

## 模块依赖规则（FR-B1.3）

- 路由层（app/api/**）只准引用 `server/<域>/index`（service 面）与 `server/platform/*`（基建）——ESLint 强制
- 域间只准 import 对方 index；跨域写走对方 service 接口（如 timeline confirm 编排四域）
- `insight` 为显式 CQRS 读侧：允许跨域 SELECT，表清单集中在 [reads.ts](../../apps/api/src/server/insight/reads.ts)
- `repo.ts` 是 SQL 唯一发生地；`service.ts` 是事务唯一发生地；`packages/ai` 保持纯包（无 DB 感知）

## 通用技术约定

- **金额**一律「分」（整数）；**时间**一律 ISO-8601，北京时间推算用 UTC getter +8h（禁本地 getter）
- **鉴权**：withAuth/withAuthParams/withAdmin/withModule 统一基座；错误体 `{error, code}`（code 为新增分类）
- **校验**：zod schema 入参（withSchema 家族）+ 语义日期校验（isValidCalendarDate/isParsableMoment）
- **审计**：AI 调用全量入 audit_logs（失败重试一次 + 可感知）；影子调用（jev*）不计用户配额
