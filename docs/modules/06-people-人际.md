# people · 人际模块

> 路径：`apps/api/src/server/people/` · 路由：`/api/contacts*` `/api/interactions*` · 表：contacts / interactions

## 一、业务介绍

人际关系是最难记账的资产。人际模块把「和谁、发生过什么、多久没见、TA 对我多重要」变成可维护的数据：

- **自动建档**：动态里提到「和老王吃饭」，老王自动出现在联系人里，往来记录同步生成——不需要手动维护。
- **分组与亲疏**：六类分组（家人/朋友/同事/同学/客户/其他）+ 亲密度（0~100）+ 重要程度五档——重要程度决定图谱中 TA 与你的距离。
- **生日不忘**：支持阳历与**农历**生日（自动换算今年公历日期），到期进入提醒。
- **看得见的关系**：星型图谱以「我」为中心，五档距离轨道铺开所有人；互动越多连线越亮，一眼看出哪些关系正在疏远。

## 二、功能与产品使用联动

| 功能 | 使用方式 | 与其他域的联动 |
|---|---|---|
| 自动建档 | 动态识别到人物 → 精确名/别名命中已有联系人则复用（避免「爸/老爸/父亲」重复建档），否则新建 | 由 timeline 域识别编排调用（persistPeople） |
| 合称拆分 | 识别约定「爸妈」拆成「爸爸」+「妈妈」两条；有名单时称呼对齐名单原文 | 联系人名单作为注入项喂给 AI（timeline/people prompt） |
| 往来记录 | 详情页时间线：类型（见面/吃饭/送礼/通话/帮忙…）+ 摘要 + 时间；可修正/删除 | 互动数联动统计；人情账（送礼净额）从财务流水「人情往来」分类聚合 |
| 亲密度/重要程度 | 档案编辑；重要程度 1~5 决定图谱轨道（亲密最近、简单最远） | 图谱布局（shared/graph）与社交元数据（shared/social）共享 |
| 生日提醒 | 首页/提醒区展示「今天/N 天后」生日；农历生日按农历换算 | insight 域 reminders 聚合消费 |
| 星型图谱 | 列表/图谱切换；滚轮/双指缩放（0.4~2.5 指针锚定）、拖拽平移、双击复位、节点拖拽摆位、点击进档案 | 节点大小=亲密度+互动频率；连线热度=互动次数；hover 高亮 |
| AI 交往画像 | 详情页「生成画像」：基于往来时间线+人情账+备注提炼喜好/忌讳/重要事实（缓存，严禁编造） | 走 ai 域 GLM 管线；画像只读接口不触发生成 |

## 三、技术实现

### 数据模型
- `contacts`：name（同人唯一，冲突拒绝不合并）/ group_tag / intimacy / importance(1-5) / birthday + birthday_type(阳历/农历) / alias / note / ai_profile + ai_profile_at（画像缓存）
- `interactions`：contact_id / type / summary / occurred_at / entry_id（识别来源可空）

### 关键机制
- **农历生日**：shared 包内置农历换算表；提醒按今年公历日期计算（已过自动顺延明年）。
- **别名命中**：自动建档时 `name = X or alias @> X` 匹配复用——「老李/李哥」对齐已有「李哥」避免变体重建档。
- **互动数联动**：interactions 增删由触发式 SQL 子查询推导（列表接口 `interaction_count` 实时可见，测试验证 2→1 联动）。
- **人情账聚合**：`gift_net_cents` = 该联系人名下「人情往来」分类流水的收支净额（people 请求时实时聚合，跨域只读 finance 表）。

### 代码结构
```
server/people/
  service.ts  # listContacts/createContact/contactDetail/updateContact/deleteContact/
              # listInteractions/createInteraction/updateInteraction/deleteInteraction/
              # cachedAiProfile/generateAiProfile
  repo.ts     # contactsRepo / interactionsRepo / peopleMoneyRepo
index.ts      # 对外面
```
路由全部 withAuth/withAuthParams 适配器 ≤30 行；图谱渲染为纯前端（shared/graph.ts 纯函数 + contact-graph.tsx SVG），数据即 /api/contacts。
