/**
 * 构建后给 out/sw.js 注入发布版本（REQ-009 FR-B8 补全）：
 * CACHE_VERSION 原是硬编码 "shiguang-v1"——纯静态导出没有任何机制改写它，sw.js 内容跨部署
 * 不变 → 浏览器连重新 install/activate 都不会发生，运行时缓存（页面 HTML + GET /api/* JSON）
 * 跨版本长期滞留，断网回退拿到旧接口数据。构建时用时间戳版本，每次发布必触发旧缓存清除。
 * 只改 out 产物（public/sw.js 源文件保持干净、git 无噪声）。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out", "sw.js");
if (!existsSync(out)) {
  console.error("[patch-sw] out/sw.js 不存在——请先 next build");
  process.exit(1);
}
const version = `shiguang-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
const src = readFileSync(out, "utf8");
if (!src.includes('CACHE_VERSION = "shiguang-v1"')) {
  console.error("[patch-sw] 未找到 CACHE_VERSION 常量（sw.js 结构变更？）——保持原样退出");
  process.exit(1);
}
writeFileSync(out, src.replace('CACHE_VERSION = "shiguang-v1"', `CACHE_VERSION = "${version}"`));
console.log(`[patch-sw] CACHE_VERSION → ${version}`);
