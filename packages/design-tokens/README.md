# @shiguangri/design-tokens

拾光三端设计令牌的**单一真源**（REQ-009 批次 9-A）。任何颜色/字号/圆角/动效/层级数值只在这里定义，由脚本生成各端产物。

## 用法

```bash
npm run tokens            # 改完 src/tokens.ts 后重新生成全部产物
npm run tokens:verify     # CI 校验：生成物与源不一致即失败
```

## 生成物

| 目标 | 说明 |
|---|---|
| `apps/web/src/app/globals.css` | `TOKENS:BEGIN web` 块 = `:root` + `[data-theme="light"]` 全部变量 |
| `apps/miniapp/src/app.scss` | `TOKENS:BEGIN page` / `TOKENS:BEGIN light` 两个变量段 |
| `apps/miniapp/src/theme.json` | 微信 `darkmode: true` 的主题映射（app.config 用 `@key` 引用） |
| `generated/mobile-themes.js` + `.d.ts` | Expo 端 `THEMES`（App.tsx import） |

## 规则

- 生成块内有 `DO NOT EDIT` 标记，**手改会被 `tokens:verify` 拒绝**；改值请编辑 `src/tokens.ts`。
- `webOnlyVars`（选区/滚动条/hover 玻璃）不进小程序；`miniappExtraVars`（input-bg）仅进小程序。
- `mobileThemes` 全部由色板派生（`withAlpha`/`alphaOf`），不存在第二份手写数值。
- 新增变量：在 `dark`/`light` 加同名键 + 加进 `groups` 对应分组（生成器会校验覆盖完整性）。
