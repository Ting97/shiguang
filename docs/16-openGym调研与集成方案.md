# 16 · openGym 调研与集成方案（2026-10-23）

> 缘起：评估把 [openGym](https://github.com/DuarteSantos8/openGym) 集成到训练模块（与训记 SynFit 集成同构：计划下发 + 实练回读）。
> 结论先行：**技术上可行且比训记更可控（实例自托管、可删数据、动作库大 4 倍），但集成层更厚**——它没有 API key 与细粒度资源端点，同步是「整档 JSON 文档 + 修订号」模型，写入方必须实现取档-改档-写回协议。建议分阶段：先自托管试用，再做只读拉取，最后视使用情况做计划下发。

## 一、产品概况

| 项 | 内容 |
| --- | --- |
| 定位 | 自托管健身房/体重追踪器——「你的数据、你的服务器」，订阅制健身 App 的开源替代 |
| 热度 | ~12.7k star（GitHub），2026-10 因 Reddit/教程文章热度陡升，活跃开发中（v1.4.x） |
| 许可 | **AGPL-3.0**（代码）；**动作演示动图是独立非商用版权（gymvisual），不得搬进拾光** |
| 功能 | 周计划例程、逐组引导（预填重量/休息计时/超级组/热身/有氧）、5600+ 动作库带动图、肌肉疲劳/滞后地图、估算 1RM、进阶规则（线性/Greyskull LP/双重进阶）、体重曲线、训练热力图、FitNotes/Strong/Hevy 导入、全量 JSON 导出、可选 AI 教练（自带 provider key）、本地只读 MCP 服务器 |
| 端 | Web（React 19 + Vite，移动友好）+ Android APK + iOS PWA，端间经自托管服务端同步 |

## 二、架构与数据模型（决定集成形态的关键）

- 后端是 `node:http` 手写路由（无框架），**数据不进数据库**：每用户整个应用状态存为一个 JSON 文件（`data/state-<user>.json`），nginx 静态托管前端 + 反代 `/api`
- 状态文档包含：`workouts`（训练记录）、`routines`（例程）、`bodyweight`、自定义动作、卡片、收藏、设置、周计划器
- 同步协议：`GET /api/data` 取全档 → 本地改 → `PUT /api/data`（带 `baseRev`）整体写回；修订号乐观并发，冲突 409
- **第三方写入保护**：服务端保留 tombstone（`deleted`）与编辑时间戳（`edited`/`_ts`/`_f`），未打戳的第三方改动不会覆盖手机端未同步的新修改；未知字段写回时从已存副本恢复
- 媒体（动作图/训练照片）与状态分离：内容寻址（SHA-256）独立端点，配额限制

## 三、API 与鉴权（对照训记）

| 维度 | 训记 SynFit | openGym |
| --- | --- | --- |
| 鉴权 | **API key**（Bearer，App 内申请，每账号一把） | **无 API key**：passkey（WebAuthn）/可选密码/一次性配对码换 **Bearer token**（90 天会话签名）——token 获取需人肉在网页操作一次 |
| 资源端点 | 细粒度（读某日训练/写训练/目录，各有 schema） | **只有整档** `GET/PUT /api/data`（+媒体/Push/管理端点） |
| 并发 | 官方限频（同日 90s 读窗口） | 自托管无限频；但**整档替换**——并发写靠 revision + tombstone 协议 |
| 删除 | **无删除接口**（写错只能去 App 手删） | 自己的服务器，随便删 |
| 目录 | 1222 动作（含别名标注） | 5600+ 动作（含动图；文本可经 API 拿到） |

## 四、若做成训记同款「拉取」（实练回读）——低风险，推荐先做

**目标**：用户在 openGym（手机）里逐组打勾记录实练，拾光计划卡「回读打卡」把当日实练拉回。

1. **凭据**：用户在拾光【我的】填 openGym 实例地址 + 一次性配对码（openGym 网页发起 `/api/pair/create` 得码 → 拾光后端 `/api/pair/redeem` 换 Bearer token）。token 与实例地址存 `user_integration_keys`（REQ-042 迁移 068 已建，`provider='opengym'` 直接复用，token 走既有 AES-256-GCM 加密列）。
2. **读取**：`GET /api/data`（带 Bearer）→ 取 `workouts[]`，按日期过滤当日 → 映射到拾光 `session_logs`/打卡 actual。workout 结构含 exercises→sets（weight/reps/done），与训记 trains 结构类似，可复用 `trainsToStrengthActual` 的映射思路重写一份。
3. **安全**：纯读，永不 PUT，零合并风险；token 加密存储 + 脱敏展示，同 REQ-042 防线。
4. **工作量**：一个小模块（client + 映射函数 + 一个路由 + 配置卡扩展），约一天。

## 五、若做成训记同款「同步」（计划下发）——可行但要做整档写回协议

**目标**：拾光生成的计划写入 openGym 当日 workout / 周例程，用户在其 App 里跟练。

1. **写回协议**（必须严格遵守，否则会 clobber 用户手机端未同步的修改）：
   - `GET /api/data` 取全档 + 当前 `rev` → 内存深拷贝 → 只**追加或更新自己拥有的记录**（建议 id 用统一前缀如 `shiguang-<planId>` 便于识别与幂等：存在即更新、不存在即插入）→ 对改动记录打 `_ts` 与 `_f` 标记 → `PUT /api/data` 带 `baseRev`
   - 409（rev 过期）→ 重取重放（指数退避，上限 3 次）
   - **永不**动 `deleted`/`edited` 已存在的非自有记录；不认识的字段原样保留（服务端也会兜底恢复）
2. **语义映射**：拾光力量计划 → openGym workout（`exercises[].sets[]` 目标重量/次数，done=false）或 routine（周计划视角）；跑步 → cardio 练习条目。命名无需目录校验（openGym 动作库 5600+ 且支持自定义动作，比训记的 1222 名单宽松得多，REQ-022/023 那套 AI 对名/确认映射基本可以免掉）。
3. **触发**：与训记一致——确认卡勾选或计划卡按钮，`syncOpenGym(planId)`；幂等靠 id 前缀；失败回滚语义天然（重 PUT 即覆盖）。
4. **风险与缓解**：整档大（数年数据几 MB 级）→ 拾光侧不落库存档、每次现取现写；用户在 openGym 网页同时编辑 → revision 重试兜底；升级 breaking change → openGym 开源可读源码 + OpenAPI 规范（`api/openapi.yaml`），跟随升级。
5. **工作量**：约 2~3 天（协议层 + 映射 + 确认卡接线 + 测试），比训记厚在没有「写当日」的专用端点。

## 六、部署形态建议

- tencent 服务器同机 Docker Compose（amd64 镜像官方提供），nginx 加一段 `/opengym/` 反代到其容器端口——与拾光同域免跨域，HTTPS 复用现有证书
- 资源占用小（静态前端 + 文件存储后端）；备份 = 定期 tar `data/` 目录（纳入现有备份脚本）
- 多用户：openGym 自带 passkey 注册（可开邀请码/管理员建号），家人各自注册即可；拾光侧每人绑定自己的 token（同 REQ-042 模式）

## 七、安全与合规

- **AGPL-3.0**：拾光只做 HTTP API 集成（网络交互不构成衍生作品），不改其源码即无传染风险；若未来改其代码自用需开源改动（当前方案不涉及）
- **动作演示动图（gymvisual）为非商用版权**：即使做了集成，动图也只能在 openGym 自己的界面里展示，不可缓存/搬运进拾光资产
- 数据驻留：全部在本机文件，不外发（其 AI 教练功能默认关闭，开启也只用自己配的 key）

## 八、分阶段落地建议

| 阶段 | 内容 | 判据 |
| --- | --- | --- |
| 0 试用（先做） | tencent 起 openGym 实例，日常用它官方 App 记训练 1~2 周 | 是否比训记顺手（打勾速度/组间计时/历史回看） |
| 1 只读拉取 | REQ-042 凭据模式扩展 provider='opengym'，计划卡「回读打卡」支持 openGym 源 | 试用养成习惯 |
| 2 计划下发 | 整档写回协议 + 确认卡接线 | 阶段 1 使用频率高 |
| 3 替代评估 | 训记 vs openGym 双轨一段时间后二选一下线另一条 | openGym 覆盖训记全部用例（目录大、可删数据是优势） |

> 与 REQ-042 的关系：本批建的 `user_integration_keys`（user_id, provider, api_key_enc）就是为多集成凭据设计的——openGym 的 Bearer token + 实例地址（地址非秘密可另存 config 列或约定 provider 约定默认实例）可直接复用该表与绑定/解绑/脱敏 UI 范式。
