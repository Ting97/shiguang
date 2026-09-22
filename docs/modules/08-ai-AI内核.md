# ai · AI 内核模块

> 路径：`apps/api/src/server/ai/` + `packages/ai/` · 路由：`/api/asr` `/api/admin/prompts*` `/api/admin/ai-mode` `/api/tokens/usage` · 表：ai_prompts / ai_prompt_versions / audit_logs

## 一、业务介绍

AI 内核是拾光的「大脑」：把用户随口的一句话变成结构化的人生数据，把积累的数据变成洞察。设计原则：

- **双引擎各取所长**：Jev（TypeSafe System One）擅长闭集判断——带校准概率、快约 6 倍；GLM 擅长开放词汇生成（标题/时间/人名/建议）。识别管线按需组合两者。
- **永不失败**：任何 AI 故障都有兜底——Jev 失败回落 GLM，GLM 失败回落规则引擎，打卡这个动作永远成功。
- **提示词是资产**：18 个 prompt 的 system/user 模板/注入开关/数值参数全部纳管，后台可调、版本化、可回滚、装配可预览（零 token）。
- **用量透明**：每次调用记审计（stage/engine/model/耗时/token），配额对用户可解释。

## 二、功能与产品使用联动

| 能力 | 使用方式 | 联动 |
|---|---|---|
| 五域识别 | timeline 域发布动态触发 | 产物写 timeline 登记簿，确认后落四域 |
| 三模式开关 | /admin「调用引擎模式」卡：off（全 GLM）/ shadow（影子对照）/ on（实时接管） | off→shadow→on 一键切换即时生效；shadow 期间只写一致率审计 |
| 混合引擎（on） | Jev 闭集 12 问 + GLM 瘦身开放词汇 → 合并层 → 确定性后处理 | 降级链：Jev 失败/瘦身不合格 → 全量 GLM → 规则引擎 |
| 空间归属 | Jev 双问（是否相关 noul + 归属 choice） | goal 域动态归属、待办继承 |
| 四级复盘/交易周报 | insight/finance 域消费 generate 能力 | 缓存+配额+prompt 全部纳管 |
| 行动拆解 | goal 域 todo 卡「拆解」 | 已有行动去重注入 |
| Prompt 调优 | /admin 三段：System 编辑 / 输入装配（模板+注入开关+参数）/ 版本历史回滚；装配预览零 token | 保存 60s 内全进程生效 |
| 语音转写 | 首页按住说话 | GLM-ASR 自研 multipart + 重试 |
| 用量统计 | /profile 与 /admin：30 天滚动次数 + token（按模型分列） | 影子调用（jev*）不计入用户配额 |

## 三、技术实现

### 传输层（packages/ai）
- **双通道**：`GLM_TRANSPORT=sdk`（默认，Vercel AI SDK `@ai-sdk/openai-compatible`）/ `legacy`（自研 fetch 等价回退，PoC 实测对照后切换：SDK 78% ≥ legacy 67%）
- **策略层保留**：总预算内指数退避重试 → 429 持续限流降级 fallback 模型 → 额度熔断（quota 失败后 5 分钟直走规则）→ 鉴权/参数错误不重试
- **GLM 私有扩展**：thinking/reasoning_effort/max_tokens(4096 防截断) 经 body 补丁 fetch 注入；思考模型 reasoning_content 兜底（legacy）
- **结构化错误**：GlmError(kind: quota/auth/rate/server/network/timeout/badOutput)——429 判定基于 SDK APICallError.status 而非字符串匹配

### 识别管线（packages/ai/parse.ts）
```
parseInput（全量 GLM）/ parseHybridInput（3-D 混合）
  Jev：extractClosedSetQuestions() 一次并行 12 问（noul 概率→布尔、choice→枚举、概率作置信）
  GLM：瘦身提取 OpenVocabExtraction（title/start/end/due/durationMin/people/dietItems/mood/counterparty/amountCents）
  合并：闭集信 Jev（含否决权）、开放字段信 GLM、金额不一致宁漏勿错
  → mapAiResult 确定性后处理 → ParseResult（engine: llm/llm-repaired/rules/jev-hybrid）
降级链：Jev→GLM→rules；schema 不合格自动带错误清单重问一次
```

### 纳管与配置
- `ai_prompts`：18 个 key 三件套（system / user_template / context_config）；`ai_prompt_versions` payload 快照支持整体回滚
- `ai-inputs.ts` 注册表：每 key 的占位符全集、注入项（required 锁定）、数值 caps（min/max 钳制）——保存校验占位符完整性
- 装配器 `assembleUserPrompt`：占位符替换 + 空块折叠；`/api/admin/prompts/[key]/preview` 走与线上同源装配（零 token）
- **配置单源**：GLM_MODEL/JEV 等默认值只在 packages/ai 与 server/platform/config.ts 定义

### 计量与配额
- `audit_logs`：每次调用一行（stage/engine/model/latency/tokens/ok/error）——成本监控与 shadow 一致率统计的数据源；写入失败重试一次+结构化告警
- `quota.ts`：30 天滚动窗口次数（free 限额/pro 不限/admin 不限），jev* 模型排除（影子不烧额度）
- 巡检：`patrol.ts` 补跑超时识别（见 timeline 域文档 FR-C2.4）
