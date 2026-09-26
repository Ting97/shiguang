import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import path from "node:path";

type Merge = (...args: unknown[]) => UserConfigExport<"webpack5">;

export default defineConfig<"webpack5">(async (merge: Merge) => {
  const baseConfig: UserConfigExport<"webpack5"> = {
    projectName: "shiguang-miniapp",
    date: "2026-9-26",
    designWidth: 750,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: "src",
    outputRoot: "dist",
    plugins: [],
    defineConstants: {
      // API 基址：生产 https://shiguang.ting97.cn；本地联调用 TARO_APP_API_BASE 环境变量覆盖
      TARO_APP_API_BASE: JSON.stringify(process.env.TARO_APP_API_BASE ?? "https://shiguang.ting97.cn"),
    },
    copy: { patterns: [] },
    framework: "react",
    compiler: "webpack5",
    alias: {
      "@": path.resolve(__dirname, "..", "src"),
    },
    mini: {
      // monorepo：packages/shared 以 TS 源码直接发布（exports → ./src/*.ts），
      // 默认 babel 编译排除 node_modules，这里显式纳入（Taro 官方 compile.include 方案）
      compile: {
        include: [path.resolve(__dirname, "..", "..", "packages", "shared", "src")],
      },
      optimizeMainPackage: { enable: true },
    },
  };
  return merge({}, baseConfig, {});
});
