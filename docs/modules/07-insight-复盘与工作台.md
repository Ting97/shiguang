# insight · 复盘与工作台模块

> 路径：`apps/api/src/server/insight/` · 路由：`/api/review*` `/api/today` `/api/reminders` · 表：review_caches / review_gen_quotas / user_ai_profiles

## 一、业务介绍

记录的价值在于回看。insight 是系统的**反思层**：把散落的动态、日程、待办、收支、人际聚合成四个尺度的复盘（日/周/月/年），AI 把数据变成「做得好的、要改进的、下阶段建议」；月度复盘沉淀出**用户画像**（习惯/偏好/规律/事实），再反哺后续 AI 的个性化。日粒度上，**今日工作台**把此刻需要关心的东西（今日日程环、今日行动、提醒）聚合到一个开屏页。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 今日工作台（/today 或首页） | 日程环（24h 占用）、今日待办、今日饮食 kcal、提醒 | 跨域聚合：time/goal/timeline/contacts |
| 提醒 | 生日（农历自动换算）、到期待办（remind_at ≤ now） | 数据来自 people/goal 域 |
| 四级复盘 | 日历页「生成小结」：AI 基于当期真实记录生成 summary + highlights + suggestions | 读侧聚合 18 张表（reads.ts 声明）；走 AI 配额与审查 |
| 小结链 | 周复盘读取各日小结、月读各周、年读各月——逐级聚合不重复生成 | 复用低层 review_caches |
| 画像沉淀 | 月报生成后异步 profile_merge：合并旧画像 + 本月事实 → 新画像（≤40 条） | 画像注入识别与复盘 prompt 个性化 |
| 交易周报 | 财务页复盘 tab：本周收支统计 + AI 解读 | 与财务域共享统计口径；配额独立一池 |

## 三、技术实现

### 数据模型
- `review_caches`：`(user_id, kind, period_key)` 唯一；kind 含 day/week/month/year/**trade_week**；review JSONB + updated_at
- `review_gen_quotas`：`(user_id, kind, period_key)`；bonus（数据更新加成）/used/last_data_at
- `user_ai_profiles`：habits/preferences/patterns/facts 四数组 JSONB

### 关键机制
- **缓存与新鲜度**：同 `(kind, period_key)` 命中即秒回；`updated_at < 周期内最新数据时间` 则视为过期自动重新生成——数据变了复盘才会变，数据没变不重复烧 token。
- **生成次数门禁**（时间解锁 + 数据加成）：日 2/周 5/月 10/年 24 次；当日 20:00 前留 1 次、周日晚 8 点前留 2 次（防「刚过 0 点就烧光」）；月/年逐周/逐月解锁；周期内数据有更新 bonus+1；历史周期全开；管理员不限。
- **小结链**：周 facts = 本周聚合 + 各日小结（读缓存）；月 facts = 本月聚合 + 各周小结——低层小结是高层的输入，避免重复解读。
- **读侧声明**（FR-B1.3）：`reads.ts` 集中声明允许跨域 SELECT 的 18 张表，repo 查询不得越清单——模块边界的显式契约。

### 代码结构
```
server/insight/
  review-ctx.ts     # buildReviewCtx：四档复盘的 facts/明细/小结链/画像装配（共享路径，路由与 /admin 预览同源）
  review-input.ts   # chatReviewJson、画像 loadProfileBlock/merge
  review-cache.ts   # getOrGenerateReview：缓存命中/新鲜度/重生成 + 审计
  review-quota.ts   # REVIEW_LIMITS / timeCeiling（时间解锁）/ acquire·consumeGeneration
  review-prompts.ts # 四档 system prompts + 画像合并 + 交易周报
  reads.ts          # 跨域读表白名单（FR-B1.3）
index.ts            # 对外面（cache/quota）
```
路由 review/day|week|month|year 严格保留检查顺序：auth → AI 配额 402 → 入参 400 → hasApiKey 503 → 生成。
