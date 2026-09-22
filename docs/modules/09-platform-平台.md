# platform · 平台模块

> 路径：`apps/api/src/server/platform/` · 路由：`/api/admin/invites` `/api/admin/grants` `/api/auth/invites` `/api/billing/*` `/api/export` `/api/files/*` `/api/health` · 表：invite_codes / user_module_grants / app_config

## 一、业务介绍

平台模块承载「产品作为一个可运营服务」的公共能力：新用户从哪来（邀请码）、哪些人能用哪些新功能（模块授权）、付费与额度怎么管（套餐计费）、用户数据怎么带走（导出）、文件怎么安全地存取（托管）、服务是否健康（探活）。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 邀请码 | /admin 生成（选有效期），发给对方在登录页「凭邀请码注册」 | 注册由 identity 域校验消费（一码一人，用后作废） |
| 模块授权 | /admin 用户列表 × 🏦负债/📈复盘 开关，即时生效 | 用户财务页二级 tab 条件渲染；API 层 withModule 双重门禁 |
| 套餐计费 | free/pro；pro 解锁 AI 无限额度；/admin 可代改套餐 | ai 域配额（30 天滚动窗口）按 plan 判定 |
| 数据导出 | /api/export?type=json\|md 一键带走全部数据（json 全量 / md 可读） | 聚合 finance/timeline/goal 域数据（只读） |
| 文件托管 | /api/files/[...key] 鉴权后流式返回上传图片与静态资源 | timeline 域图片写入 uploads 目录 |
| 健康检查 | /api/health：DB/上传目录可写/AI 配置/迁移待执行 | 部署探活与巡检；audit 连续失败可作降级信号 |
| 配置中心 | app_config 键值表：Jev 模式覆盖、setup 令牌消费标记 | 各域读取（DB 覆盖优先 env 兜底） |

## 三、技术实现

### 数据模型
- `invite_codes`：code 主键 / used_by（唯一，一码一人）/ expires_at
- `user_module_grants`（031）：`(user_id, module)` 主键，module ∈ debt/trade_review
- `app_config`（030）：key + JSONB value——Jev 模式覆盖、setup 令牌消费标记等
- 依赖 identity 域 profiles / sessions

### 关键机制
- **grants 即时生效**：me.modules 实时查库（无缓存），授权/撤销后前端 tab 与 API 门禁同步变化；gates 路由已 withAdmin 化（未登录 401 / 非管理员 403）
- **静态托管门卫**：[[...p]] catch-all 托管 web 静态导出；未登录页面跳 /login；/api/health 显式豁免鉴权
- **fail-fast 配置**：config.ts 启动校验（生产禁 AUTH_DISABLED、弱连接串拦截），APP_ENV=production 显式标记
- **统一错误体**：ApiError {error, code}——error 文案兼容现状，code 为新增分类

### 代码结构
```
server/platform/
  index.ts        # modules 对外面
  db.ts           # pool + findOverlap/overlapError
  config.ts       # env 集中读取 + fail-fast（initConfig）
  modules.ts      # getModuleUser / listUserModules
  http/route.ts   # withRoute/withAuth/withAuthParams/withAdmin/withModule/withSchema 家族
  http/errors.ts  # ApiError + ZodError 映射
  http/logger.ts  # 结构化日志 + AsyncLocalStorage requestId
  security/       # rate-limit（滑动窗口）/ login-guard（双层防护）/ csrf（Origin 校验）
```
路由：invites/grants/billing/export/files 均 withAuth/withAdmin 适配器；[[...p]] 为静态流式托管（豁免迁移）。
