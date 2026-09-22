# AGENTS.md —— AI 编码代理协作约定（REQ-004 FR-A4.2）

拾光（shiguangri）：个人经营系统（时间·目标·人际·财务 + AI 内核）。Monorepo：npm workspaces，Node ≥20。

## 结构

- `apps/web`：Next.js 15 App Router，`output: export` 纯静态；UI 全部 `"use client"`
- `apps/api`：Next.js standalone，托管 API 与 web 静态导出（catch-all）；业务在 `src/lib`（4-C/4-D 起迁往 `src/server/<domain>`）
- `apps/mobile`（Expo，不重写）、`apps/android`/`apps/native`（WebView 壳）
- `packages/ai`：AI 内核（zod 契约 + GLM/Jev + 规则兜底）——**纯包，禁止 import DB/服务器层**
- `packages/shared`：类型/纯函数（日期、农历、CSV、图谱、api 客户端）
- `packages/db`：`schema.sql` + 手写 SQL 迁移 + `runner.ts`

## 常用命令

```bash
npm run build            # 构建 web + api（构建 api 前必须先杀 3100 端口进程——Windows 文件锁会卡死构建）
npm run build:web / build:api
npm test                 # 全部 workspace 单测（node:test + tsx）
npm run lint             # ESLint（0 error 为合入线；warning 数不新增）
npm run typecheck        # 三端 tsc --noEmit
npm run db:migrate       # 增量执行迁移（--status 看差异）
npm run poc              # 规则引擎 20 句自测；npm run poc:live 为 GLM 实测（需 .env）
```

本地起 API：`set -a && source .env && set +a && AUTH_DISABLED=1 PORT=3100 node apps/api/.next/standalone/apps/api/server.js`
（真实登录态测试用 `AUTH_DISABLED=0` 覆盖。）

## 代码规范

- TypeScript strict；金额一律「分」（整数）；时间一律 ISO-8601，**北京时间展示/推算必须用 UTC getter + 8h**（`getHours()` 等本地 getter 在 CST 宿主会二次偏移——历史 bug，禁止复刻）
- SQL 只允许参数化（`$1` 占位），禁止字符串拼接；跨表查询放 lib/repo 层
- React 受控输入测试/脚本注入值必须走 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` + input 事件（Playwright fill 不触发 React onChange）
- 中文写入文件一律用 UTF-8（Windows bash heredoc 传 python 会坏码——用 Edit 工具）

## 安全红线

1. **新 env 必须同步 `apps/api/src/server/platform/config.ts`**，禁止在业务代码直接读 `process.env`
2. 密钥只存 .env（已 gitignore）——任何 key 出现在代码/文档/日志即事故
3. 生产环境 `AUTH_DISABLED` 必须为空（config fail-fast 会拒绝启动）
4. 迁移只增不改：已上线迁移文件禁止修改（runner checksum 会拒绝）；新迁移按序号递增
5. 生产 DB 变更前先 `pg_dump` 备份

## 部署

双 tar（standalone + web out）→ `/opt/shiguangri_new_tmp` 解包 → systemctl 交换（`shiguangri.service`）→ 冒烟
（`/login` 200、`/api/auth/me` 401、新增端点 401）。SSH 别名 `tencent`，生产 https://shiguang.ting97.cn 。

## 文档

需求/批次记录在 `docs/requirements/<包名>/`（01 需求、02 开发设计、03 测试与部署）；每批完成必须补录 03 文档。
