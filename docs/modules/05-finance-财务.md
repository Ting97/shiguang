# finance · 财务模块

> 路径：`apps/api/src/server/finance/` · 路由：`/api/accounts*` `/api/transactions*` `/api/budget` `/api/finance/*` `/api/debts*` · 表：accounts / transactions / budgets / liabilities / liability_payments

## 一、业务介绍

财务模块让钱「记得住、看得清、还得上」：

- **记得住**：动态里说一句「打车花了30」自动入账；支付宝/微信官方 CSV 一键导入（幂等去重）；也可以手动记一笔。
- **看得清**：月度收支/结余/储蓄率、分类占比、近 6 月趋势、预算预警、账户余额一览；交易复盘给出日/周统计与 AI 周报。
- **还得上**：负债管理覆盖信用卡/房贷/车贷/消费贷/花呗白条/亲友借款六类——还款自动递减余额、到期墙分级提醒、雪球 vs 雪崩清债策略模拟。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 自动记账 | 动态说「午饭花了28」→ 识别确认后自动生成支出流水（分类/金额/对方） | timeline 域识别编排写入 transactions，entry_id 关联原文 |
| 草稿确认 | 动态识别的流水先入草稿（首页黄色提醒区），确认选账户后计入报表 | — |
| 记一笔/改流水 | 手动补记、修改分类/金额/账户/对方；「还款」为合法分类（负债联动产生） | 分类集 TX_CATEGORIES 与负债管理共享 |
| 账户管理 | 现金/支付宝/银行卡等账户，期初余额 + 流水推导动态余额；归档保留历史 | 负债还款联动所选账户记支出 |
| 预算 | 月度支出上限 + 预警阈值（50~90%），进度条与超支提示 | 概览页每日消费 |
| 月度报表 | 概览 tab：收支/结余/储蓄率/分类占比/环比/近 6 月趋势 | — |
| 账单导入 | 支付宝/微信官方 CSV；dryRun 预览→确认入库；外部单号幂等去重 | 分类自动映射（含「还款」关键词前置） |
| **负债管理**（授权模块） | 档案（六类型/本金/利率/月供/还款日/到期日/优先级）→ 还款（余额递减、还清自动结清、可选联动记账）→ 到期墙（≤3 月 danger / ≤6 月 warn）→ 策略模拟（雪球 vs 雪崩） | 授权由 platform 域 user_module_grants 控制；还款可联动生成「还款」支出流水 |
| **交易复盘**（授权模块） | 日/周统计（环比/分类/账户分布/日趋势/Top 对方）+ AI 交易周报 | 统计纯 SQL 零 AI；周报走 AI 配额，prompt 在 /admin 可调 |

## 三、技术实现

### 数据模型
- `accounts`：name（同人唯一）/ icon / opening_balance_cents / archived（软归档）
- `transactions`：direction(in/out) / amount_cents / category / counterparty / note / occurred_at / account_id / is_draft / source（manual/voice/csv_import）/ entry_id / external_no（幂等键）
- `budgets`：单行 upsert（monthly_limit_cents + alert_threshold 1-100 钳制）
- `liabilities`（032）：type 六类枚举 / principal_cents / balance_cents / rate_pct(0-36) / monthly_cents 可空 / due_date / priority / status
- `liability_payments`（032）：amount / paid_at / account_id / tx_id（联动流水回填）

### 关键机制
- **余额恒等式**：账户余额 = 期初 + Σ(流水方向推导)，无冗余存储——导入/修正/删除流水天然一致（测试两轮复查精确相等）。
- **还款联动**（事务）：插还款记录 → 余额递减（`greatest(0, …)`）→ 归零自动 `status='cleared'` → 可选联动生成「还款」支出流水并回填 tx_id → 同日同额 409 防重。
- **加权利率与到期墙**：Σ(余额×利率)/Σ余额；到期墙按月差分级（≤3 月 danger / ≤6 月 warn），daysLeft 按北京时区计算。
- **策略模拟**（`finance/debt/debts-sim.ts` 纯函数）：月复利 → 先扣各笔最低月供 → 剩余预算按雪球（余额升序）/雪崩（利率降序）清偿；600 月封顶；相对基线的利息节省额；额外还款为 0 时与基线利息严格相等（性质测试覆盖）。
- **语义校验**：负债入参全量校验（利率 0-36、月供正整数、还款日 1-31）；还款同日同额 409。

### 代码结构
```
server/finance/
  debt/debts.ts       # 负债 CRUD 校验/序列化（bigint→number、日期归一）
  debt/debts-sim.ts   # 模拟引擎纯函数
  index.ts            # 对外面
```
路由 14 个全部 withAuth/withAuthParams/withModule("debt"|"trade_review") 适配器；overview 的现金流口径：`剩余月供 = max(0, 月供合计 − 本月已还)`，`缺口 = 本月结余 − 剩余月供`。
