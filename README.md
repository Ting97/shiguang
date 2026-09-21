# 拾光 shiguang

> 拾起光阴，经营自己 —— **个人成长经营 AI 系统**
> 主线四轴：**时间 · 目标 · 人际 · 财务**。一句话语音/文字，AI 帮你同时记进四本账，看清并经营好自己的每一天。

[![status](https://img.shields.io/badge/status-Phase%204%20%E8%BF%AD%E4%BB%A3%E4%B8%AD-blue)]() [![线上](https://img.shields.io/badge/%E7%BA%BF%E4%B8%8A-shiguang.ting97.cn-green)]()

## 这是什么

出于**个人真实需要**而自发研发的 AI 应用——为了解决并且可视化自己的成长：**缺少一个把自己的时间、目标、人际、财务放在一处统一记录、统一复盘的经营系统**。

日常使用只需一件事：像发朋友圈一样说一句话。

> "中午和老王吃饭花了260，吃得挺开心"

AI 五域识别引擎自动拆解并登记：

- ⏱ **时间**：社交 · 12:00–13:00 落进当天 24h 时间轴（四视图日历：日/周/月/年热力图）
- 💰 **财务**：餐饮支出 ¥260，对手方自动关联（另支持支付宝/微信账单 CSV 导入、预算预警、储蓄率报表）
- 👥 **人际**：老王的往来记录 +1（联系人档案、星型关系图谱、礼尚往来账、生日与久未联系提醒）
- 🎯 **目标**：待办与计划话术自动建 TODO（"明天下午三点看牙医"），目标主线持续建设中

在此基础上，**日/周/月/年四级交叉复盘**把四条主线放在一起归因——"人情支出 +38% 的月份，社交时长也 +12 小时"，AI 喂全量明细生成小结，并沉淀用户画像，越用越懂你。

## AI 内核

- **五域识别（v2 · AI-First）**：一次AI调用联合抽取 日程/待办/收支/心情/饮食（+人物联动），置信度分流——高置信直接落库、低置信转待确认；输出经 zod 严格契约校验，失败自动带错误清单重问一次
- **确定性防漂移**：时间/金额/日期锚定由确定性引擎兜底（无日期词一律按当天），模型偶发漂移硬纠正
- **永不单点**：GLM 拥塞自动重试降级 → 规则引擎兜底 → 单域重识别随时补救，打卡入口永不失败
- **四级复盘（v3）**：SQL 聚合出事实喂全量明细（杜绝 LLM 编数字）+ 下层小结链 + 用户画像注入，次数配额管控
- **全量审计**：每次 AI 调用的阶段/模型/token 计入 audit_logs，是全站唯一计费口径（free 30 次/30 天，pro 不限）

## 系统架构（简明）

npm workspaces monorepo，逻辑共享、UI 分端：

```
apps/web      Web 客户端（Next.js 15 纯静态导出，PWA）
apps/mobile   Android 原生主力端（Expo/RN，EAS 云构建 + OTA 热更）
apps/android  Android WebView 壳（34KB 极简备选）   apps/native  iOS（Capacitor，待 Mac）
apps/api      唯一服务端（Next.js standalone）：21 组 REST API + 静态托管 + 会话门卫
packages/ai   AI 内核（GLM 客户端/五域管线/确定性时间引擎/ASR/46 句 PoC）
packages/shared 双端共享逻辑（CSV/财务/农历/图谱/Bearer/CORS）   packages/db  Schema + 20 迁移
```

部署：腾讯云单机（CentOS + Caddy HTTPS + PostgreSQL 13 + systemd），双 tar 原子发布秒级回滚。
完整分层图 / 数据模型（21 表）/ AI 管线 / 部署拓扑见 **[docs/12-系统架构与业务架构总览.html](docs/12-系统架构与业务架构总览.html)**。

## 迭代进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 调研定稿 + monorepo 脚手架 + 语音解析 PoC（测试集 ≥85% 验收） | ✅ |
| Phase 1 | 时间主线：一句话打卡、四视图日历、动态流、待办 | ✅ |
| Phase 2 | 财务主线：记账/账户/CSV 导入/预算/报表 + 账户体系（密码/短信/邮箱/邀请码） | ✅ |
| Phase 3 | 人际主线：联系人档案、星型图谱、TA 档案页、提醒横幅 | ✅ |
| M1–M3 | 三端适配（Expo 原生 v1.1.3 + WebView 壳）+ 商业化（free/pro 套餐与 AI 配额）+ 语音记账全链路 | ✅ |
| **Phase 4（当前）** | 交叉复盘 v3（已上线）· 主动消息 · **目标主线**（目标/OKR 与目标教练）· 上线收尾 | ▶️ |
| 远期 | iOS 上架 · 微信生态 · 记忆系统（pgvector RAG）· 新型决策模型观察（[Jev 调研](docs/10-技术调研-Jev决策模型详解.html)） | 规划 |

## 线上与产物

- **Web**：https://shiguang.ting97.cn （注册需邀请码）
- **Android APK**：[GitHub Releases](https://github.com/Ting97/shiguangri/releases)（Expo 原生包走 Releases，小壳入库 `apps/artifacts/`）
- 运维：发布/备份/回滚见 [docs/08-部署文档.md](docs/08-部署文档.md)

## 文档索引

[12 架构总览](docs/12-系统架构与业务架构总览.html)（必读）· [08 部署](docs/08-部署文档.md) · [09 账户体系](docs/09-账户体系.md) · [10 人际模块](docs/10-人际模块.md) · [11 使用手册](docs/11-使用手册.md) · [14 三端与商业化](docs/14-三端适配与商业化方案对比.md) · [模块优化迭代记录](docs/模块优化迭代记录.md) · 历史调研（01–07、13）见 docs 目录

## 参与开发

单人 + ZCode（智谱 Pro）协作开发。多端同步：`git clone git@github.com:Ting97/shiguang.git`
