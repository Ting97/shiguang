# 02 · GitHub 同类系统调研报告

> 调研日期：2026-09-16。星标数与活跃度来自 GitHub API 实时抓取；功能描述来自各项目 README / 官网。

## 1. 调研目标与方法

目标：寻找与「魔力空间 Mooly」（AI 日记 + 目标管理 + 生命平衡轮 + 多 Agent 陪伴）相似的开源系统，评估**直接 fork 改造 / 部分复用 / 仅作设计参考**三种利用方式。

方法：GitHub Topic 检索（`life-os`、`life-management`、`ai-journal`、`ai-journaling`、`personal-os`、`personal-knowledge-management`、`habit-tracker`、`self-reflection`）+ 关键词检索 + 逐项目核验活跃度与 License。

## 2. 重点推荐项目（按相关度排序）

### 2.1 memex-lab/memex —— ⭐ 相关度最高的整体参考

| 项 | 内容 |
|---|---|
| 地址 | https://github.com/memex-lab/memex |
| 星标 / 活跃 | ⭐737，2026-09-16 仍在更新（本项目调研当天） |
| 技术栈 | **Flutter/Dart 为主**（Dart 85.7%，另有 Python/Kotlin/Swift） |
| License | **GPL-3.0**（传染性协议，**不可直接拿代码闭源商用**） |
| 平台 | iOS + Android（已双端上架，中国区 App Store 名"妙记"） |

**功能与 Mooly 高度重合**：
- "Capture life in fragments + 多 Agent AI 整理成结构化卡片"——正是 Mooly 的核心交互；
- **Memex Agent 编排**：一个对话主 Agent 协调多个专职子 Agent（时间线卡片、PKM 归档、日程、知识洞察、诊断、评论、记忆策展、媒体处理、陪伴聊天）——对应 Mooly 的"智囊团"；
- 卡片类型体系：任务/惯例/事件/时长/进展、文章/摘录/引用/链接/对话、人物/地点、指标/评分/消费/参数、图库——比 Mooly 更体系化的结构化输出设计；
- 自动打标、实体抽取、双链；
- **本地优先**：数据在设备（文件系统 + SQLite），自带 LLM（支持 Gemini/OpenAI/Claude/GLM/DeepSeek/Qwen/Kimi/豆包/Ollama/OpenRouter 等 15+ Provider，每个 Agent 可独立配模型）；
- Markdown 归档、一键导出（零锁定）。

**评估**：
- ✅ 架构思想（多 Agent 编排、卡片类型学、BYO-LLM）是最佳参考对象；
- ❌ 与 Mooly 产品路线不同：它走"本地优先 + 无云端账号"，我方若做云端多端同步 + 订阅制，其数据层不可复用；
- ❌ GPL-3.0 + Flutter 栈：直接 fork 改造成本高且有法律约束；
- **结论：作为架构蓝本与交互参考，逐模块学习，不复制代码。**

### 2.2 usememos/memos —— 记录流（Timeline）参考

| 项 | 内容 |
|---|---|
| 地址 | https://github.com/usememos/memos ｜ ⭐63,087 ｜ Go + React ｜ 活跃 |

- 自托管轻量笔记：Markdown 时间线流、标签、多用户、Docker 一键部署。
- **对应 Mooly 的"记录流输入端"**：类朋友圈动态的时间线交互可直接参考其信息架构与 API 设计（它的 REST API 设计很干净）。
- 无 AI 能力、无目标/维度模型。可复用其"memo"数据模型与时间线 UI 思路。MIT 协议友好。

### 2.3 lobehub/lobehub（原 lobe-chat）—— 多 Agent / 角色市场 / 插件生态参考

| 项 | 内容 |
|---|---|
| 地址 | https://github.com/lobehub/lobehub ｜ ⭐82,510 ｜ Next.js ｜ 活跃 |

- 开源 AI 平台：多模型会话、**Agent 市场（角色市场）**、插件系统（MCP）、知识库 RAG、语音多模态。
- **对应 Mooly 的"角色市场 + AI 伙伴人设 + 多 Agent 会话"**。其 Agent 元数据结构（persona/提示词/开场白/模型配置）与市场分发机制值得直接借鉴。
- Next.js 技术栈与我方推荐一致，部分模块（会话 UI、模型接入层）可参考实现。

### 2.4 open-webui/open-webui —— 自托管 AI 界面的工程标杆

⭐152,220 ｜ Svelte ｜ 活跃。多 Provider 接入、RAG、权限、模型管理。作为"LLM 网关 + 多用户配额"的工程参考（自用部署场景甚至可直接用作内部调试台）。

### 2.5 HabitRPG/habitica —— 游戏化习惯/目标参考

⭐14,153 ｜ JavaScript/Vue ｜ 活跃。把目标习惯 RPG 化（角色/经验/金币/公会）。对应 Mooly 的"能量数据 / 花瓣生长 / 桌宠"等激励机制；若我方定制需求含游戏化，其数值系统设计可参考。

### 2.6 codexu/note-gen —— 中文本地优先捕获工具

⭐12,808 ｜ Tauri + React ｜ 活跃。"Capture first, organize later"：先收集后整理的双栏设计、AI 辅助整理、Markdown 存储。中文产品，交互习惯贴近国内用户。

### 2.7 其他相关项目速览

| 项目 | 星标 | 技术栈 | 与本项目的关联 | License |
|---|---|---|---|---|
| Lethe044/hermes-life-os | 191 | Python | 个人 OS Agent：学习用户、识别生活模式——"发现方向"功能参考 | MIT |
| dsebastien/obsidian-life-tracker-base-view | 239 | Obsidian | 生活数据捕获 + 可视化（八维仪表盘的数据可视化参考） | - |
| get-thriving/thrive | 172 | Python | 目标管理系统（目标拆解/进展追踪建模参考） | MIT |
| vincenzo-afk/Synapse | 33 | TS PWA | 习惯+任务+日记统一离线 PWA（本地优先方案参考） | MIT |
| aniolquer/wheel-of-life | <10 | TS | 生命平衡轮评分 + 可视化（花瓣图交互参考） | - |
| re-memo/re-memo | 7 | Python | 隐私优先 AI 日记（早期项目，仅思路参考） | - |
| markwk/mindset_journaling_app | 23 | JS | NLP 情绪分析日记（情绪识别指标参考） | - |
| SillyTavern/SillyTavern | 33,395 | JS | AI 角色扮演前端（人设/记忆/角色卡系统的极致参考） | AGPL |
| AgriciDaniel/claude-obsidian | 14,960 | - | AI 自动整理第二大脑（自动归档/标签策略参考） | - |

## 3. 对比总表：谁能覆盖 Mooly 的哪些模块

| Mooly 模块 | memex | memos | lobehub | habitica | 其他 |
|---|---|---|---|---|---|
| 极简记录流（文/图/音） | ✅ | ✅(文字) | ❌ | ❌ | note-gen |
| AI 处理管线（情绪/待办/热量/记忆） | ✅(卡片化) | ❌ | 部分(RAG) | ❌ | mindset_journal |
| 八维生命平衡轮 | ❌ | ❌ | ❌ | ❌ | wheel-of-life(仅原型) |
| 目标管理闭环 | ✅(卡片) | ❌ | ❌ | ✅(游戏化) | thrive |
| 周期洞察复盘 | ✅ | ❌ | ❌ | ❌ | hermes-life-os |
| 多 Agent 智囊团 + 角色市场 | ✅ | ❌ | ✅ | ❌ | SillyTavern |
| 私密空间/见证社交 | ❌ | 多用户 | ❌ | 公会 | - |
| 云端多端同步 + 订阅 | ❌(本地优先) | ✅ | ✅ | ✅ | - |
| **完整覆盖** | ❌ | ❌ | ❌ | ❌ | **无** |

## 4. 调研结论

1. **不存在可整体复用的开源项目**。Mooly 的组合（云端账号 + 记录流 + AI 管线 + 八维模型 + 多 Agent 人设 + 轻社交 + 订阅制）是独特组合，GitHub 上最接近的 memex 走的是"本地优先 + BYO LLM"路线，架构前提相反。
2. **推荐"自研骨架 + 精选参考"策略**：
   - 数据模型与 API 设计参考 **memos**（干净、成熟）；
   - 多 Agent 编排与结构化卡片体系参考 **memex**（设计文档级借鉴）；
   - 角色市场与人设系统参考 **lobehub / SillyTavern**；
   - 目标游戏化参考 **habitica**；
   - 八维平衡轮为自研核心差异化（仅原型级开源实现，正好是我方机会）。
3. **License 红线提示**：memex（GPL-3.0）、SillyTavern（AGPL）代码不可用于闭源商业系统；memos（MIT）、lobehub（Apache-2.0 部分模块）可安全参考。
4. **机会点**：开源界"AI 日记"赛道在 2025-2026 快速升温（memex 半年 700+ 星且当日仍在发版），说明赛道被验证；但**云端版 + 中文 + 平衡轮观测模型**的组合仍空白，我方自建后若差异化明确，甚至具备开源引流的可能性。

## 5. 三大定制需求专项调研（2026-09-16 二轮补充）

产品定位已从"仿 Mooly"转向「**个人经营系统：钱 · 时间 · 人**」，以下按三个定制模块逐一调研。

### 5.1 财务管理与复盘

| 项目 | 星标/状态 | 技术栈/License | 对本项目的价值 |
|---|---|---|---|
| [actualbudget/actual](https://github.com/actualbudget/actual) | ⭐28.9k，活跃 | TS，**MIT** | **信封预算法（Envelope Budgeting）模型的最佳参考**，本地优先；MIT 允许借鉴/复用其预算数据模型与算法 |
| [TNT-Likely/BeeCount](https://github.com/TNT-Likely/BeeCount) | ⭐2.4k，活跃 | **Flutter + Supabase + AI 记账 + MCP** | 中文产品，技术路线与我方惊人一致（连 Supabase 都相同）；**AI 捕捉记账管线直接对标**；License 为自定义（NOASSERTION），代码不可直接复用，设计可参考 |
| [firefly-iii/firefly-iii](https://github.com/firefly-iii/firefly-iii) | ⭐24.6k，活跃 | PHP，AGPL | 功能最全的自托管财务系统：账户/预算/**规则引擎自动分类**/报表；规则引擎思想值得借鉴（先规则后 AI，省钱） |
| [beancount/beancount](https://github.com/beancount/beancount) | ⭐6.0k | Python，GPL | 复式记账文本标准；若做"专业模式"可参考其三账户模型 |
| [ghostfolio/ghostfolio](https://github.com/ghostfolio/ghostfolio) | ⭐9.3k | TS，AGPL | 投资组合/净值追踪（后续做"钱生钱"视图的参考） |
| ~~maybe-finance/maybe~~ | ⭐54k，**已归档停运**（2025-07） | Ruby，AGPL | 曾经最火的"人人可用财务 App"，**死于商业化失败**——警示：纯财务工具付费意愿低，必须与成长/复盘场景捆绑 |

**商业产品参考**：钱迹（无障碍权限自动记账 + 支付宝/微信账单导入，证明"自动录入"是记账第一痛点）、微信/支付宝年度账单（复盘呈现形式）、随手记。

**结论**：记账+预算的轮子很多，但「**AI 财务复盘**（结合时间/人际数据的综合归因）」开源界为空白（搜索 AI finance tracker 仅 <30 星原型）——这正是差异化所在。

### 5.2 时间花销记录与复盘（语音打卡 + 日历时间线）

| 项目 | 星标/状态 | 技术栈/License | 对本项目的价值 |
|---|---|---|---|
| [ActivityWatch/activitywatch](https://github.com/ActivityWatch/activitywatch) | ⭐18.9k，活跃 | Python，MPL-2.0 | **全自动被动追踪**标杆（窗口/屏幕监控→自动分类）；若做"被动模式"可参考其分类体系与本地架构；MPL 可复用 |
| [almarklein/timetagger](https://github.com/almarklein/timetagger) | ⭐1.8k | Python，GPL | "**Tag your time**" 打点式记录 + **横向时间线 UI**——与"说一声自动登记日历"的呈现形态最接近，交互设计直接参考 |
| [GothenburgBitFactory/timewarrior](https://github.com/GothenburgBitFactory/timewarrior) | ⭐1.7k | C++，MIT | 命令行时间追踪与报表（时间桶/标签/聚合报表的数据模型参考） |
| [GothenburgBitFactory/taskwarrior](https://github.com/GothenburgBitFactory/taskwarrior) | ⭐6.1k，活跃 | C++，MIT | 任务管理老牌标杆（任务依赖/优先级/UDA 设计参考） |
| [isair/jarvis](https://github.com/isair/jarvis) | ⭐1.8k | - | 本地私有 AI 语音助手（语音交互链路参考） |

**商业产品参考**：ATimeLogger（活动时间统计）、Toggl（一键打点+报表）、RescueTime（全自动+效率评分）、iOS 屏幕使用时间、时间块（Time Blocking）方法论。

**结论**：「**语音说一声 → AI 识别分类 → 自动登记日历时间线**」在开源界**没有成熟实现**（被动追踪的有，语音主动播报的没有）——这是我方核心自研点，且与 Mooly 的语音记录管线、ASR/分类技术栈高度复用。日/周/月/年聚合复盘可参考 timewarrior 报表模型 + timetagger 可视化。

### 5.3 人际关系图谱

| 项目 | 星标/状态 | 技术栈/License | 对本项目的价值 |
|---|---|---|---|
| [monicahq/monica](https://github.com/monicahq/monica) | ⭐25.3k，**半维护**（795 open issues，2026-04 后放缓） | PHP/Laravel，AGPL | **个人 CRM 品类定义者**：联系人档案/互动时间线（activities）/重要日期提醒/亲密度/礼物记录——**数据模型是人际模块的最佳蓝本**；PHP+AGPL 不宜复用代码 |
| [Volmarg/personal-management-system](https://github.com/Volmarg/personal-management-system) | ⭐4.2k，活跃 | PHP/Symfony，**MIT** | "全合一个人管理"（财务+联系人+日历+笔记+密码+待办）证明赛道成立；MIT 友好；技术栈老仅作信息架构参考 |
| [fbuchner/meerkat-crm](https://github.com/fbuchner/meerkat-crm) | ⭐284，活跃 | - | "CRM for the personal life"，轻量生活 CRM 参考 |
| PeopleDex / Nexus 等原型 | 0 星级 | - | 图谱化人际追踪仅有原型级实现（刚起步，说明方向新） |

**商业产品参考**：Clay / Dex（海外个人 CRM，自动聚合通讯录+互动提醒）、飞书/Notion 人脉模板、QQ"好友亲密度"（游戏化亲密度数值设计）。

**结论**：Monica 定义了个人 CRM 的数据模型但**没有图谱可视化、没有 AI**，且项目已显疲态；「**关系图谱可视化 + AI 提炼（谁在淡出/谁值得深交）+ 礼尚往来记账**」是明确的空白机会。图谱渲染建议用成熟前端库：**AntV G6 / Cytoscape.js / react-force-graph**（无需自研）。

### 5.4 三模块调研总结论

1. **每个单点都有强者，组合无人做过**：财务看 Actual/BeeCount、时间看 ActivityWatch/timetagger、人际看 Monica——但「钱+时间+人 三合一仪表盘 + 语音录入 + AI 交叉复盘」没有任何项目覆盖，**Mooly 本身也不覆盖**（它只有轻量记账附属功能）。
2. **可复用性排序**：数据模型层面大量可借鉴（Monica 的 activities、Actual 的信封预算、timewarrior 的时间桶）；代码层面仅 Actual（MIT）与 ActivityWatch（MPL）可安全参考；BeeCount/Firefly/Monica 均 GPL 系只能看设计。
3. **商业化警示**：Maybe（54k 星）之死证明纯工具付费难——我方"财务+时间+人"数据沉淀后 AI 复盘的**信息价值**（而非工具本身）才是订阅理由，且三大数据天然形成迁移壁垒。
4. **与我方技术路线的巧合**：BeeCount 用 Flutter+Supabase+AI 记账已验证中文用户接受度，我方 Next.js+Supabase+GLM 路线风险进一步降低。

## 6. 参考链接

**第一轮（Mooly 对标）**：
- memex：https://github.com/memex-lab/memex
- memos：https://github.com/usememos/memos
- lobehub：https://github.com/lobehub/lobehub
- open-webui：https://github.com/open-webui/open-webui
- habitica：https://github.com/HabitRPG/habitica
- note-gen：https://github.com/codexu/note-gen
- hermes-life-os：https://github.com/Lethe044/hermes-life-os
- thrive：https://github.com/get-thriving/thrive
- Topic 页：[life-os](https://github.com/topics/life-os) · [life-management](https://github.com/topics/life-management) · [ai-journal](https://github.com/topics/ai-journal) · [personal-os](https://github.com/topics/personal-os) · [awesome-second-brain](https://github.com/Mindola-ai/awesome-second-brain)

**第二轮（三定制模块）**：
- actual：https://github.com/actualbudget/actual （财务·信封预算·MIT）
- BeeCount：https://github.com/TNT-Likely/BeeCount （中文记账·AI 捕捉）
- Firefly III：https://github.com/firefly-iii/firefly-iii （自托管财务·规则引擎）
- beancount：https://github.com/beancount/beancount （复式记账）
- ghostfolio：https://github.com/ghostfolio/ghostfolio （投资净值）
- ActivityWatch：https://github.com/ActivityWatch/activitywatch （自动时间追踪）
- timetagger：https://github.com/almarklein/timetagger （时间线打点 UI）
- timewarrior / taskwarrior：https://github.com/GothenburgBitFactory/timewarrior · https://github.com/GothenburgBitFactory/taskwarrior
- monica：https://github.com/monicahq/monica （个人 CRM 标杆）
- Volmarg PMS：https://github.com/Volmarg/personal-management-system （全合一·MIT）
- meerkat-crm：https://github.com/fbuchner/meerkat-crm
- 图谱可视化库：AntV G6（https://github.com/antvis/G6）· Cytoscape.js（https://github.com/cytoscape/cytoscape.js）· react-force-graph（https://github.com/vasturiano/react-force-graph）
