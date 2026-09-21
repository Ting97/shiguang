# APP 体验轮训状态（定时任务：每小时一轮，至 2026-09-22 09:00 停止）

> 每轮定时任务必读本文件。项目根：`D:\project\shiguang\shiguangri`（monorepo：apps/web Next.js 15 静态导出、apps/api Next.js standalone、packages/{ai,db,shared}；apps/mobile 本轮一律不动）。
> 生产：https://shiguang.ting97.cn（远程 git@github.com:Ting97/shiguang.git main）。部署流程与红线见 `docs/08-部署文档.md`。

## 轮训顺序（每轮按序挑 1~2 个，跳过最近两轮已体验的；有遗留问题的模块优先）

1. 首页今日（今日行动清单、今日概览、日程速览）
2. 时光流动态 feed（卡片、图片九宫格/灯箱、空间徽标、编辑删除菜单）
3. 动态发布（文字/语音/拍照/图片上传/离线识别、publish-sheet）
4. 清单待办 todo-board（任务/行动层级、「⋯」菜单卡片、AI 拆解、重复🔁、筛选 chips）
5. 目标空间 /spaces（列表、详情、AI 拆解、关联动态、新建/编辑/归档）
6. 日程 schedule（三 tab）
7. 财务 finance + 账单导入
8. 人际 contacts（列表 + 详情）
9. 复盘 calendar（日/周/月/年四卡）
10. 提醒 reminders
11. 个人中心 profile（邀请入口、主题切换、退出）
12. 登录/注册流程
13. 管理后台 /admin（AI prompt 管理、营销管理）
14. 全局体验（底部导航、转场、错误态、性能手感）

## 轮次记录

| 时间 | 模块 | 报告文件 | 修复/迭代 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-09-22 03:10 | 首页今日 + 时光流 feed | [2026-09-22-03-首页今日与时光流.md](./2026-09-22-03-首页今日与时光流.md) | F1 识别超时兜底（feed recognize_state + 前端「识别未完成」态）；F2 今日到期顶层待办完成后保留（进「今日已完成」可恢复） | API 断言 2/2 PASS + 375 浏览器复核通过；测试数据已清理 |

## 遗留问题池（从 001 需求 03-测试与部署.md 及历轮体验累积；每轮迭代优先从这里挑）

- Expo App 端图片能力（用户明确本轮跳过，勿动 apps/mobile）
- 行动手动拖拽排序（当前仅 afterId 插入式，无拖拽 UI）
- /admin prompt 修改试运行 dry-run（二期可选）
- P3：搜索框 placeholder 移动端缩短为「搜索动态…」（375 下贴边）
- P3：动态「⋯」菜单无顶部导航避让 clamp
- P2：feed 末条滚动 padding 让出麦克风 FAB（悬浮遮挡文字）
- P3：空日程时 24 点时间轴压缩/折叠（占两屏）

## 环境与已知坑

- 本地体验服务：`cd apps/api/.next/standalone/apps/api && set -a && source .env && set +a && PORT=3100 AUTH_DISABLED=1 nohup /d/nodejs/node.exe server.js`；本地 DB 为 docker 容器 shiguangri-pg。
- 部署红线：构建 API 前必须杀掉 3100 node 进程（Windows 文件锁会卡死构建）；构建后必须重新 `cp -r apps/web/out apps/api/.next/standalone/apps/api/out`。
- 生产登录密码未入库（STATE.md 无记录时，生产只做未登录冒烟：/login 200、核心 API 401；不阻塞本轮）。
- Bash 工具偶发 `spawn bash.exe ENOENT`：用 node REPL `cp.spawnSync("C:\\Program Files\\Git\\bin\\bash.exe", ["-c", "..."])` 应急。
- 惰性日切：06:00 为记录日界（EFF_TODAY）；本地测试造的数据结束前清理。
