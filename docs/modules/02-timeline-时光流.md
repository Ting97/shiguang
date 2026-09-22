# timeline · 时光流模块（核心域）

> 路径：`apps/api/src/server/timeline/` · 路由：`/api/parse` `/api/feed*` `/api/entries/*` · 表：entries / entry_recognitions / entry_images / voice_logs / diet_records

## 一、业务介绍

时光流是整个产品的**采集入口与识别中枢**。用户发一条动态（打字、按住说话、拍张照片），系统把这句话变成结构化的人生记录：

- **一句话，六维识别**：AI 从原话中同时识别出「做了什么（日程）」「要做什么（todo）」「花了/收了多少钱」「此刻心情」「吃了什么（饮食）」「和谁在一起（人物）」。
- **先落库秒回**：动态本体立即入库（永不丢），识别在后台异步完成——网络慢、AI 抖动都不阻塞记录这个动作。
- **人不确认不入账**：AI 结果先进入「待确认」，用户在动态卡片上一键确认才真正写入时间轴/账本；低置信的识别也会转待确认而不是乱写。
- **可修正**：识别错了可以在卡片上手动补录/改判/重识别，原话编辑后自动全域重识别。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 发动态 | 首页输入框/语音（GLM-ASR 转写）/拍照，Enter 发布 | 走 AI 配额（free 30 天滚动额度）；识别结果由 ai 域管线产出 |
| 动态卡片 | 展示识别出的日程/待办/金额/人物/饮食/心情与置信状态；低置信项带「确认」按钮 | **确认（confirm）编排四域写入**：日程→time_blocks、待办→todos、收支→transactions、人物→contacts+interactions、饮食→diet_records |
| 编辑原话 | 替换式重识别：清空旧产物 → analyzed_at=null → 后台全域重跑 | 同发动态链路；失败留痕由巡检补跑（FR-C2.4） |
| 动态流（feed） | 按时间倒序聚合展示全部产物；关键字检索覆盖原文与所有识别产物；按空间过滤 | 空间数据来自 goal 域 goal_spaces；人物来自 people 域 |
| 删除动态 | 按依赖顺序清理全部子表（防孤儿日程/待办），图片文件异步清理 | 子表分属 time/goal/finance/people 四域 |
| 手动补录/单域重识别 | 识别菜单对单一域重新提取或手工补充 | 单域 prompt（DOMAIN_PROMPTS）注意力更集中更准 |
| 图片 | 每条动态 ≤9 张、单张 ≤5MB、魔数白名单校验、事务落库 | 文件字节存 platform 域 uploads 目录，静态访问走 files 路由鉴权 |

## 三、技术实现

### 数据模型
- `entries`：raw_text、source（keyboard/voice）、mood/mood_score、space_id、**analyzed_at**（识别完成时间戳——null 即「识别中」，超 10 分钟前端显示「识别未完成」）、**analyze_retries**（036 巡检补跑计数）
- `entry_recognitions`：识别登记簿，`(entry_id, domain)` 唯一；status ∈ pending/applied/none；confidence/engine 供前端与统计
- `entry_images`：storage_key/mime/宽高/sort；`voice_logs`：语音转写留痕；`diet_records`：餐次+条目 JSON+kcal

### 关键机制
- **识别任务不丢失**（FR-C2.4）：识别失败不再打 analyzed_at，而是 `analyze_retries+1` 留痕；巡检器 `patrol.ts` 每 5 分钟扫描「analyzed_at null 且超 10 分钟且 retries<3」的动态自动补跑（批量 5、进程级防重入）。进程重启/识别崩溃都不再造成永久「识别中」。
- **成功才打点**：`analyzeAndPersist` 成功路径自写 analyzed_at——失败留痕与巡检语义成立的前提。
- **编辑重识别**：事务内清空六张子表 + 重置 analyzed_at，秒回后后台重跑；确认按钮的重复提交由登记簿唯一约束与状态机防护。
- **检索防注入**：用户关键字 ilike 前转义 `% _` 通配符；空间过滤参数严格 uuid 校验。

### 代码结构
```
server/timeline/
  analyze.ts  # 识别编排核心（五域管线调用/心情回写/登记簿写入/审计/影子对照/空间归属）
  service.ts  # ingest / confirmPending / listFeed / patchFeed / deleteFeed /
              # appendManual / reRecognize / addEntryImages / deleteEntryImage / ...
  repo.ts     # entries/识别登记簿/子表清理 SQL 唯一发生地
  storage.ts  # 上传目录、存储键、魔数嗅探、MIME 单源（mimeForPath）
  patrol.ts   # FR-C2.4 识别巡检补跑
index.ts      # 对外面
```
路由全部为 withAuth/withAuthParams 适配器（parse/confirm/feed 系列均已 ≤50 行）。
