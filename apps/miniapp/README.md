# miniapp 开发约定（docs/15 第 3/4 批子代理必读）

## 文件布局（路由已在 src/app.config.ts 声明，禁止改动 app.config.ts / app.ts / app.scss）

- 页面 = 目录三件套：`index.tsx` + `index.config.ts`（`export default definePageConfig({...})`）+ `index.scss`
- 页面路径必须与 app.config.ts 声明一致（如 `packages/debt/index/index.tsx`）
- 样式令牌用 app.scss 的 CSS 变量：`var(--bg/--surface/--elevated/--ink/--ink-soft/--ink-mute/--accent/--success/--danger/--warn/--line-soft)`；通用原子类 `card / btn-primary / btn-ghost / input / banner(+ok/err) / h1 / h2? (无 h2，可页面内自定义) / dim`；页面私有样式写各自 index.scss

## 数据层

- 一律 `import { request, upload, ApiError } from "@/lib/request"` 发请求；不要自己写 wx.request；不要改 `src/lib/request.ts` / `src/lib/session.ts`
- 现成端点函数见 `src/lib/api.ts`（可 import；**不要修改该文件**——避免多代理冲突）。缺的端点在本页面目录建 `api.ts` 局部封装，用 `request<T>(path, {method, body})`
- 401 已由 request 层统一清 token 跳登录；页面内 catch 显示 `e.message` 即可（错误文案服务端已中文）

## Taro/React 约定

- Taro 4 + React 18：组件写普通函数组件， hooks 用 `@tarojs/taro` 的 `usePullDownRefresh / useReachBottom / useRouter` 等；跳页 `Taro.navigateTo`（分包页）/`Taro.switchTab`（tab 页）
- 首次加载模式：`const [inited,setInited]=useState(false); if(!inited && getSessionToken()){setInited(true); void refresh();}`（见 pages/feed/index.tsx 范例）
- 视觉基调：深色玻璃卡（`card` 类）、28px 正文、列表行 `display:flex; gap:16px`；金额支出 `money-out` 收入 `money-in`
- 时间显示统一北京时区：`new Date(new Date(iso).getTime()+8*3600_000)` 后取 UTC 字段（对齐 web lib/bj-time）
- 金额分→元用 `yuan()`（@/lib/api）
- 禁止：window/document/localStorage/fetch/DOM API；不引入新 npm 依赖
- 中文注释，注释讲「为什么/坑」，不写「这行做什么」

## 契约要点

- 金额一律分（*_cents，可能是 string——node-pg bigint，比较前 Number()）
- 流水列表 `GET /api/transactions?month=YYYY-MM` → `{transactions:[{id,direction,amount_cents,category,counterparty,note,occurred_at,is_draft,account_name}]}`；待确认 `is_draft:true`，确认 `PATCH /api/transactions/:id {confirm:true}`（**流水不入账：无 accountId**）
- 负债 `GET /api/debts` → `{liabilities:[...]}`（字段 name/type/balance_cents/monthly_cents/pay_day/due_date/status/priority）；总览 `GET /api/debts/overview`；还款 `POST /api/debts/:id/payments {amountCents,paidAt}`；备付 `GET /api/debts/reserve?ym=` / 勾选 `PUT /api/debts/reserve {ym,liabilityId,checked}`
- 复盘 `GET /api/finance/review/week` / `GET /api/review?month=`（402 配额、429 限频、503 上游——展示 message 徽标即可）
- 交易只读：`/api/trading/accounts|daily?accountId&from&to|equity?accountId|trades?accountId&page|digest?accountId|review?accountId`（**无写入口**）
- 日程块 `GET /api/blocks/range?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{blocks:[{id,activity_id,title,start_at,end_at,time_mode}]}`；todo `GET /api/todos` → `{todos}`、`PATCH /api/todos/:id {done}`、新增 `POST /api/todos {title,...}`（具体必填字段 grep apps/web/src/components/todo-board 确认）
- 空间 `GET /api/spaces` → `{spaces:[{id,name,icon,...}]}`；详情 `GET /api/spaces/:id`；感悟 `GET/POST /api/spaces/:id/reflections`
- 人际 `GET /api/contacts` → `{contacts:[...]}`；详情 `GET /api/contacts/:id`
- 图片上传：`upload<T>("/api/files", filePath)`（POST multipart 字段 file）→ 返回 `{key}`?——**先 grep apps/web/src/components/publish-sheet.tsx 确认端点与返回结构再用**
- 语音：`Taro.getRecorderManager()` format wav 采样率 16000，≤30s；`transcribeAudio(filePath)` → `{text}`
