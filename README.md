# 拾光复利 shiguangri

> 拾起光阴，记录今日 —— 个人经营系统：**钱 · 时间 · 人**
> 一句话语音/文字，同时落进时间轴、财务账、人情簿，AI 帮你看清自己的每一天。

[![status](https://img.shields.io/badge/status-Phase%200%20%E5%90%AF%E5%8A%A8-blue)]() [![docs](https://img.shields.io/badge/docs-v1.0%20%E5%AE%9A%E7%A8%BF-green)]()

## 这是什么

仿照并超越「魔力空间 Mooly」模式的 AI 个人成长系统，核心差异化：

- **⏱ 时间日记（P0）**：说一句"刚跑完步40分钟"→ AI 自动识别类别与起止时间 → 四级日历自动登记（日 24h 时间轴 / 周列式 / 月历 / 年度热力图）
- **💰 财务**：时间记录中含金额自动入账（"中午和老王吃饭花了260"→ 餐饮支出 + 人情往来双落账）+ 支付宝/微信 CSV 导入 + 月度总上限预警 + 储蓄率复盘
- **👥 人际图谱**：联系人档案 + 星型关系图 + **点开 TA 即见：一起经历的时间线与喜好提炼** + 礼尚往来账
- **AI 交叉复盘**：日/周/月/年，钱×时间×人三轴归因（"人情支出+38%的月份，社交时长也+12小时"）

## 项目文档（v1.0 定稿，2026-09-16）

| 文档 | 内容 |
|---|---|
| [docs/01-产品分析-魔力空间Mooly.md](docs/01-产品分析-魔力空间Mooly.md) | 对标产品 Mooly 全量拆解 |
| [docs/02-GitHub同类系统调研报告.md](docs/02-GitHub同类系统调研报告.md) | 25+ 开源项目调研（memex/Actual/Monica/ActivityWatch…） |
| [docs/03-技术方案与架构设计.md](docs/03-技术方案与架构设计.md) | 技术栈：Next.js + Expo + Supabase + GLM + AntV G6 |
| [docs/04-开发计划与里程碑.md](docs/04-开发计划与里程碑.md) | 时间→财务→人际→上线，15~17 周排期 |
| [docs/05-待确认需求清单.md](docs/05-待确认需求清单.md) | 全部需求确认记录（已关闭） |
| [docs/06-时间日记模块-任务拆解.md](docs/06-时间日记模块-任务拆解.md) | P0 模块实施规格（页面/解析规则/验收） |
| [docs/07-PoC测试集-20句打卡话术.md](docs/07-PoC测试集-20句打卡话术.md) | 语音解析 PoC 验收基准（≥85% 通过） |

## 技术栈

Next.js 15 (App Router) · React Native (Expo) · Supabase (Postgres+pgvector) · GLM（ASR/解析/复盘） · AntV G6 · Turborepo monorepo · Docker Compose 自有服务器部署

## 当前状态

- ✅ 调研与需求定稿（2026-09-16）
- ▶️ **Phase 0 进行中**：monorepo 脚手架 + Schema + 语音解析 PoC（20 句测试集验收 ≥85%）
- ⏭ Phase 1：时间日记模块（5 周）

## 线上环境

**https://shiguang.ting97.cn** —— 腾讯云 + Caddy(HTTPS) + PostgreSQL 13 + systemd，发布/运维/备份详见 [docs/08-部署文档.md](docs/08-部署文档.md)

## 参与开发

单人 + ZCode（智谱 Pro）协作开发。多端同步：`git clone git@github.com:Ting97/shiguangri.git`
