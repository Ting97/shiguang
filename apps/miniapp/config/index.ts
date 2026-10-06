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
    // 关闭持久编译缓存（REQ-导航下移缩小期间发现）：本机文件系统上缓存失效不可靠，
    // 曾三次出现「源码已改、产物仍旧」的幽灵构建，宁可每次全量编译（约 10s）。
    cache: { enable: false },
    alias: {
      "@": path.resolve(__dirname, "..", "src"),
    },
    mini: {
      // monorepo：packages/shared 以 TS 源码直接发布（exports → ./src/*.ts），
      // 默认 babel 编译排除 node_modules，这里显式纳入（Taro 官方 compile.include 方案）。
      // 用谓词而非路径字面量：Windows 下 workspace 是 junction（webpack 解析 symlink 后的真实路径
      // 与 path.resolve 的大小写/分隔符可能不一致，字面量不命中会报 "no loaders" 解析错误）。
      compile: {
        include: [
          (filename: string) => filename.replace(/\\/g, "/").includes("/packages/shared/src/"),
        ],
      },
      optimizeMainPackage: { enable: true },
    },
  };
  return merge({}, baseConfig, {});
});
