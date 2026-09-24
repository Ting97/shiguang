/**
 * ESLint 平面配置（REQ-004 FR-A4 / 4-A）。
 * 策略：基线取最小必要集保证现库全绿，后续批次增量收紧；
 * apps/api 额外启用领域依赖规则（route 只准 import 域 index / platform）。
 * 规则覆盖顺序：后面的块覆盖前面的（flat config 语义）。
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/out/**", "**/dist/**", "apps/mobile/**", "docs/**", ".zcode/**", "**/next-env.d.ts"] },
  {
    // Node 环境的 .mjs 脚本（tools/e2e 脚本）需要 node/browser 全局
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { console: "readonly", fetch: "readonly", process: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "error",
      "@next/next/no-img-element": "off",
    },
  },
  {
    // TS 项目关闭 no-undef（类型系统已覆盖）；现库基线先关噪项，增量收紧（4-C/4-D 逐步开启）
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // 红线 1（AGENTS.md）机器化：业务代码禁止直读 process.env，必须走 platform/config。
    // 白名单：config 自身、middleware/instrumentation（边缘运行时/框架生命周期不宜 import 携带 AI SDK 的 config）、
    // packages/ai（纯包禁止 import apps/api，反向会循环依赖）、*.d.ts 与脚本。
    files: ["apps/api/src/**/*.ts", "apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    ignores: ["**/platform/config.ts", "**/platform/db.ts", "**/middleware.ts", "**/instrumentation.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "禁止直读 process.env——请从 @/server/platform/config 或既有集中入口读取（AGENTS.md 红线 1）",
        },
      ],
    },
  },
  {
    // packages/ai 与脚本文件需要 process.env（GLM/Jev 配置；纯包不能 import apps/api 的 config）
    files: ["packages/ai/src/**/*.ts", "packages/shared/src/**/*.ts", "packages/db/**/*.ts"],
    rules: {},
  },
  {
    // 领域依赖规则（FR-B1.3，lib 已清零）：
    // ① 业务域深路径禁止直引——路由只准引用域 index（对外 service 面）
    // ② @/lib/* 防御性禁止（lib 已删除）
    // platform/* 是共享基建层放行。批③路由迁移完成后 severity 升 error。
    files: ["apps/api/src/app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/lib/*"], message: "lib 已清零（FR-B1.4）" },
            ...["identity", "timeline", "time", "goal", "finance", "people", "insight", "ai"].map((d) => ({
              group: [`@/server/${d}/*`, `!@/server/${d}/index`],
              message: `路由只准引用 @/server/${d}（index service 面），禁止深路径（FR-B1.3）`,
            })),
          ],
        },
      ],
    },
  },
);
