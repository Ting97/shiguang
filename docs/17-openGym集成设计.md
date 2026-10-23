# 17 · openGym 集成实施设计（阶段 1/2：计划下发 + 回读拉取 + 佳明管线）

> 前置：[16 · openGym 调研与集成方案](./16-openGym调研与集成方案.md)（阶段 0 实例已上线）；本文基于 **v1.4.2 源码精读**（api/server.js、import-csv.js、catalogue 数据）给出三条流的落地设计。结论先行：**比 docs/16 预估的更顺**——服务端会替外部写入者自动打同步戳（源码注释明说支持「an API script」），目录自带官方中文名表，动作名匹配不需要 AI 兜底也能闭环（未命中落自定义动作，用户可在 App 里看到并修正，不会像训记那样被拒）。

## 〇、公共基础

### 0.1 凭据层（复用 REQ-042 基建）

- `user_integration_keys` 新 provider=`opengym`：`api_key_enc` 存 **Bearer token**（AES-256-GCM，同训记绑定管线）。实例地址走 config env `OPENGYM_BASE_URL`（默认 `https://shiguang.ting97.cn:8443`，平台级不落库）。
- **绑定 UX**（与手机 App 配对同机制，无需 passkey）：用户在浏览器登录 openGym → 设置 → 账户 →「Pair the mobile app」生成一次性码（5 分钟有效）→ 粘贴到拾光【我的 → openGym 绑定】→ 后端 `POST /api/pair/redeem {code}` 得 `{token, user:{id,name}}`（源码 2144 行）→ 加密落库 + 显示账号名。
- **token 续期**：`GET /api/me`（Bearer）在 token 过半寿命时返回新 `{token}`（源码 1959 行）——拾光侧每次外部调用前顺带 /api/me，响应带 token 即更新库。
- 服务器间直连（拾光 API → openGym API）非浏览器，**无 CORS 顾虑**；Bearer 免 CSRF（源码 662 行）。

### 0.2 中文动作名 → openGym 目录 ID（三流共用）

- 目录：`catalogue/exercises/*.json`（6554 条，id/英文名/bodyPart/equipment/target）+ **`catalogue/i18n/zh.json`（5632 条 id→官方中文名）**。
- 拾光侧建快照（仿 REQ-022 训记目录：DB 单行快照 + 内存缓存；来源可直接读服务器 `/opt/opengym/catalogue/i18n/zh.json` 经内网，或仓库 vendor 一份随版本更新）。
- 匹配管线（词袋思路抄官方 import-csv.js 的 matchExercise，但基于中文）：
  1. **精确**：规范化（去空格/全角）后 zh 名全等；
  2. **策展别名表**：拾光常用名 → id（人工维护，起步 ~50 条，含「跑步」→ 有氧跑步条目）；
  3. **字符重叠打分唯一命中**：借鉴训记 prefilterCandidates（重叠占比 ≥ 阈值且唯一最高分才收，宁缺勿错）；
  4. **未命中 → 自定义动作**（openGym 原生机制）：`{id: "sg-ex-<sha1(name)前12>", n: <拾光名>, custom: true, eq: "custom", tg: "", desc: "", bp: <默认"waist"或按名称猜>}`，随 workout 写入 state.exercises——用户在 App 里可见可改名，**不阻断同步**；
  5. （阶段 2 可选增强）GLM 批量匹配兜底，候选必须 ∈ zh 名集合防编造，同 REQ-022 防线。
- 逆映射（回读用）：id → zh 名（zh.json 直查；自定义动作 → 其 `n`）。

## 一、流 1：训练计划下发（拾光 → openGym）

**触发**：训练计划卡新增「同步 openGym」按钮（与「同步训记」并列；确认卡复选框阶段 2 再收口成多目标）。

**写协议**（`PUT /api/data`，源码 2185-2295 行）：

1. `GET /api/data` → `{state, rev}`（整档 JSON）；
2. 深拷贝改档：只动**自有记录**——workout `id = "sg-plan-<拾光planId>"`（天然幂等：存在即更新，不存在即插入）；
3. `PUT {state, baseRev: rev}`；409（他端已写）→ 用响应带回的最新档重放，指数退避 ≤3 次；
4. **无需自管同步戳**：`stampPut` 会给「不打戳的外部写入者」的改动自动打戳（源码 2259 行注释明示支持 API 脚本），手机端后续 merge 不会冲掉我们的记录；tombstone/未知字段恢复也由服务端兜底。

**workout 映射**（结构对齐 import-csv.js 产出，674-680 行）：

```
{ id: "sg-plan-<planId>", d: "YYYY-MM-DD"（计划日）, start: 当日18:00 ms, end: start,
  routineId: null, name: "<计划title> · 拾光", prs: [], vol: 0,
  entries: [{ id: <目录ID或自定义ID>, sets: [...], topW: null }] }
```

- 力量条目：`sets = [{w: kg一位小数, r: <repsText区间上限>, done: false}, ...]`（组数=sets；rir 透传 `rir` 字段）；计时动作（repsText 为秒）→ `{sec, done: false}`；热身组可标 `phase: "warmup"`（拾光暂无此语义，略）。
- 跑步条目：目录有氧跑步条目（zh 精确「跑步」）→ `sets = [{min: <时长或按配速推>, speed: <km/h 一位小数>, done: false}]`（配速 s/km → speed = 3600/pace 四舍五入 1dp；分段 → 多组）。注意 openGym 有氧组存 `min+speed`，距离是派生值（min/60×speed）。
- **重复同步语义**：同 id 更新时，保留用户已打勾的组（按序 merge：新目标组 done:false，用户原 done:true 的组按序回填）——防「改个计划把练了一半的进度抹了」。
- 计划删除**不**联动删 workout（保守；阶段 2 可选 tombstone 删除）。

## 二、流 2：回读拉取（openGym → 拾光打卡）

**触发**：计划卡「回读打卡」识别到用户绑定的是 openGym 时走此路径（与训记回读同入口分流）。

**读协议**：`GET /api/data`（纯读零风险）→ `state.workouts` 按 `d = 计划日` 过滤，**优先 `id === "sg-plan-<planId>"`**，否则当日任意 workout（用户手动练的也能回读）。

**映射**（复用训记回读的状态机与 todos 联动）：

- 力量：`entries[].sets` 中 `done:true` → `{weightG: w×100, reps: r}` 按 entry 聚合；entry 名经逆映射（§0.2）回拾光名，与计划 exercises 对齐（名称近似 + 顺序）；`doneSets/totalSets` → allDone → `updatePlan(status: done|partial, actual)`——与 `pullXunjiCompletion` 同款落库/行动完成管线。
- 跑步：有氧 entry 的 `min+speed` → `distanceM = Σ(min/60×speed)×1000`、`durationS = Σmin×60` → `paceSPerKm`。
- 自定义动作回读：entry.id 以 `sg-ex-` 开头或 state.exercises 含该 id → 用其 `n`（拾光原名）直接对齐，零误差。

## 三、流 3：佳明计划 → openGym

**结论：无需独立通道**。佳明计划在拾光的现状管线是「截图 → AI 识别 → parsePlanDraft →（REQ-022 已把佳明名对齐为训记中文官方名并 note 记「佳易名：xxx」）→ savePlanDraft 落为普通计划」——下发 openGym 走**流 1 同一条管线**。名称链两跳：`佳明原名 →(已有)→ 训记中文官方名 →(§0.2 zh 映射)→ openGym 目录 ID`；未命中落自定义动作（动作原名保留在拾光侧 note 与 openGym 自定义动作名里）。训记中文名与 openGym 官方中文名同属常见中文健身词汇，命中率预计高；实测命中率低再加阶段 2 的 AI 批量匹配。

## 四、风险与边界

| 风险 | 评估/缓解 |
| --- | --- |
| 整档随历史膨胀（源码注释见 2.4MB 档例） | 个人量级 GET/PUT 全档可接受（内网毫秒级）；不做拾光侧缓存档 |
| 与手机端并发写 | 409 重放 + 服务端打戳 + 手机端 sync-merge，官方协议内闭环 |
| openGym 升级 breaking change | OpenAPI 规范随仓库；实例源码就在 `/opt/opengym`，可 diff 跟进；镜像升级前 `data/` 备份即可回滚 |
| AGPL 传染 | 仅 HTTP API 调用，不抄代码；动作图（非商用版权）不搬运 |
| 数据备份 | `/opt/opengym/data`（tar 即全量）纳入服务器例行备份 |
| 训记/openGym 双外部并存 | 阶段 1 各自独立按钮；阶段 2 若 openGym 试用胜出，训记侧下线（沿用 019 策略档案下线的先例） |

## 五、分期与工作量

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| 1a | 凭据绑定（配对码→token，含续期）+ openGym 只读回读打卡 | ~1 天 |
| 1b | 计划下发（力量+跑步）+ zh 目录快照与匹配层（精确/别名/重叠打分/自定义兜底）+ 重复同步保留进度 | ~1.5 天 |
| 2 | 佳明名 AI 批量匹配增强（如实测命中率低）、确认卡多目标勾选、删除联动可选 | 按需 |

实施批次建议：阶段 1a+1b 合一批交付（REQ-043，迁移零——`user_integration_keys` 已在 068 建好，opengym 只加 provider 行）。
