# miniapp 重构约定（对齐 web 移动端 · 第 N 批子代理必读）

目标：小程序每个页面与 **web 移动端**（手机宽度的 web 页面）视觉与结构**一模一样**。
基准 = apps/web 的组件源码，不是旧版小程序。重构前先读对应 web 源文件，再重写页面。

## 铁律

1. **禁止修改**：`src/app.scss`、`src/lib/**`、`src/components/**`、`src/lib/api.ts`、`src/app.config.ts`、`src/app.ts(x)`。缺的端点在页面目录建局部 `api.ts` 用 `request<T>(path,{method,body})`；缺的全局类向批次长（主会话）提出，不要自己加。
2. **单位换算：web 的 1px = 小程序 2 单位**（designWidth 750）。所有 web 样式值 ×2 落到 scss。`rem` 按 ×16px 再 ×2。
3. **页面骨架**：除登录/绑定页外，每页最外层用 `PageShell`（`import PageShell from "@/components/page-shell"`）：
   ```tsx
   <PageShell active="finance">…</PageShell>
   ```
   `active` 取值：`feed | spaces | schedule | contacts | finance`；二级页（负债/复盘/交易/日历/详情）沿用所属主区块的 key（负债/复盘/交易 → "finance"）；「我的」页不传 active（无高亮）。
4. **组件用 `@tarojs/components` 的 PascalCase**（View/Text/ScrollView/Image/Textarea/Button/Picker…），事件 `onTap`。禁止 window/document/localStorage/fetch/DOM。
5. **导航**：主区块间跳转 `Taro.redirectTo`（等价 tab，栈恒 1）；下钻详情 `Taro.navigateTo`，详情页**必须**有可见返回（`Taro.navigateBack`，web 同位置有返回链）。** tabBar 已移除，禁止 `switchTab`**（编译不过）。
6. **主题**：不要自己写颜色切换。浅色令牌由 `.theme-light` 类自动生效（PageShell 已挂）。深浅双主题都必须用令牌变量（`var(--ink)` 等），不许写死深色值；个别半透明白/黑遮罩可写死（与 web 一致）。

## 全局类词汇表（app.scss 已备好，直接用；括号=web 对应物）

- 布局：`app-bg`（body 极光底）、`page-body`（max-w-2xl px-5 pb-28 pt-5）、`hero`+`text-gradient`（text-3xl 渐变标题）、`safe-top/safe-bottom`
- 卡片：`glass`（.glass 移动端形态）+ `glass-p4`/`glass-p5`（rounded-2xl p-4/p-5）；页面私有尺寸组合写自己 scss
- 按钮：`btn-primary`（渐变白字）/`btn-ghost`/`btn-sky-tinted`/`btn-purple-tinted`（AI 动作）/`btn-inline-save`；尺寸用私有 scss 补（如 px-7 py-2 → 56/16）；按压态 `hoverClass="press"`；禁用加 `.disabled`
- 输入：`input`（input-glow rounded-xl bg-surface/60 同款）+ `input-placeholder`
- 反馈：`empty-state`（虚线空态）、`msg-banner` + `msg-banner-ok/-err`
- chips：`chip`（TagChip 胶囊标签；语义色用页面 scss 或内联 style 给底/字色，参照 web TONE_*）、`chip-filter`(+`-active`)（FilterChip）
- 二级导航：`pill-nav` 容器 + `pill`/`pill-active`（SubNav、视图切换 pill 组）
- 弹层：`overlay`（bg-black/50 z-55）+ `sheet`（底部弹层 rounded-t-2xl bg-surface p-4 safe-bottom）；居中弹层自己写（= Modal 移动端形态 items-end）
- 悬浮发布钮：`fab-capture`
- 文字：`dim/dim-soft/hint/money-in/money-out`；`skeleton`（骨架屏）、`fade-up`（入场）

## 数据层（不变）

- 一律 `import { request, upload, ApiError } from "@/lib/request"`；401 已统一跳登录；catch 里展示 `e.message`
- 现成端点函数 `src/lib/api.ts`（可 import 不可改）；金额分→元 `yuan()`；时间北京时区 `new Date(new Date(iso).getTime()+8*3600_000)` 取 UTC 字段
- 金额 `*_cents` 可能是 string，比较前 `Number()`

## 重构验收标准（每页）

1. JSX 结构层级与 web 组件一致（卡片→头部→内容→识别区→操作区），类名对应关系写在注释里（如 `{/* = web moment-card.tsx */}`）
2. 深浅主题都正常（令牌化），玻璃卡/胶囊/渐变按钮与 web 同款
3. 中文注释讲「为什么/坑」；不留死代码；旧 scss 全量重写不留孤儿类
4. `npx tsc --noEmit` 对自己文件零错（其他批次文件的错不管）
