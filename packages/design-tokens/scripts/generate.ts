/**
 * 设计令牌生成器：从 src/tokens.ts 渲染四端产物。
 *
 *   npm run tokens            # 重新生成（写入目标文件）
 *   npm run tokens:verify     # 只比对，不一致 exit 1（CI 用）
 *
 * 目标：
 * - apps/web/src/app/globals.css            TOKENS 块（:root + [data-theme=light] 全部变量）
 * - apps/miniapp/src/app.scss               TOKENS 块 page / light（变量段）
 * - apps/miniapp/src/theme.json             微信 darkmode 主题映射
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dark, light, groups, webOnlyVars, miniappExtraVars,
  motion, zIndex,
} from "../src/tokens";

const verify = process.argv.includes("--verify");
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");

// ---------- 校验：分组必须恰好覆盖双主题色板 ----------
{
  const declared = new Set(groups.flatMap(([, keys]) => keys));
  for (const [name, palette] of [["dark", dark], ["light", light]] as const) {
    const keys = Object.keys(palette);
    const missing = keys.filter((k) => !declared.has(k));
    const unknown = [...declared].filter((k) => !(k in palette));
    if (missing.length || unknown.length) {
      console.error(`[tokens] ${name} 分组与键不一致 缺:${missing} 多:${unknown}`);
      process.exit(1);
    }
  }
}

// ---------- 渲染 ----------

/** CSS 变量声明（不含选择器），indent 控制缩进 */
function renderCssVars(palette: Record<string, string>, indent: string, opts: { webOnly: boolean; extras?: Record<string, string> }): string {
  const pad = indent + "  ";
  const lines: string[] = [];
  for (const [label, keys] of groups) {
    const kept = keys.filter((k) => opts.webOnly || !webOnlyVars.has(k));
    if (!kept.length) continue;
    lines.push(`${pad}/* ---- ${label} ---- */`);
    for (const k of kept) lines.push(`${pad}--${k}: ${palette[k]};`);
  }
  if (opts.extras) {
    const keys = Object.keys(opts.extras);
    if (keys.length) {
      lines.push(`${pad}/* ---- 小程序补充（无 color-mix，显式给值） ---- */`);
      for (const k of keys) lines.push(`${pad}--${k}: ${opts.extras[k]};`);
    }
  }
  return lines.join("\n");
}

/** 非颜色刻度（主题无关）：动效时长/缓动/层级，随色板一起写入 :root 与 page{} */
function renderScaleVars(): string {
  return [
    "  /* ---- 动效与层级刻度（主题无关） ---- */",
    `  --dur-fast: ${motion.fast}ms;`,
    `  --dur-base: ${motion.base}ms;`,
    `  --dur-slow: ${motion.slow}ms;`,
    `  --dur-slower: ${motion.slower}ms;`,
    `  --ease-out: ${motion.easeOut};`,
    `  --ease-standard: ${motion.easeInOut};`,
    `  --z-sticky: ${zIndex.sticky};`,
    `  --z-overlay: ${zIndex.overlay};`,
    `  --z-modal: ${zIndex.modal};`,
    `  --z-toast: ${zIndex.toast};`,
    `  --z-max: ${zIndex.max};`,
  ].join("\n");
}

/** web：单个 TOKENS 块 = :root（dark）+ [data-theme=light] 两段 */
function renderWebBlock(): string {
  return [
    ":root {",
    "  color-scheme: dark;",
    "",
    renderCssVars(dark, "", { webOnly: true }),
    renderScaleVars(),
    "}",
    "",
    '[data-theme="light"] {',
    "  color-scheme: light;",
    "",
    renderCssVars(light, "", { webOnly: true }),
    "}",
  ].join("\n");
}

/** miniapp：page（dark+extras）/ .theme-light（light+extras）两段（只含变量，不含背景等属性） */
function renderMiniappBlock(which: "page" | "light"): string {
  const palette = which === "page" ? dark : light;
  const extras = miniappExtraVars[which === "page" ? "dark" : "light"];
  const vars = renderCssVars(palette, "", { webOnly: false, extras });
  return which === "page" ? `${vars}\n${renderScaleVars()}` : vars;
}

/** 替换「TOKENS:BEGIN name」与「TOKENS:END name」两处标记注释之间的内容（保留标记注释与缩进） */
function replaceTokenBlock(src: string, name: string, content: string): string {
  const bIdx = src.indexOf(`TOKENS:BEGIN ${name}`);
  const eIdx = src.indexOf(`TOKENS:END ${name}`);
  if (bIdx < 0 || eIdx < 0 || eIdx < bIdx) throw new Error(`缺少 TOKENS 标记: ${name}`);
  const bEnd = src.indexOf("*/", bIdx) + 2;
  const eStart = src.lastIndexOf("/*", eIdx);
  // content 由渲染函数按目标缩进产出（本仓各目标均为 2 空格），直接原样插入
  return src.slice(0, bEnd) + "\n" + content + "\n" + src.slice(eStart);
}

// theme.json：微信 darkmode 主题映射（key 由 app.config window 以 @key 引用）
function renderWechatThemeJson(): string {
  return JSON.stringify(
    {
      light: { bgColor: light.bg, bgTxtStyle: "dark" },
      dark: { bgColor: dark.bg, bgTxtStyle: "light" },
    },
    null,
    2,
  ) + "\n";
}

// ---------- 写入 / 比对 ----------

const results: Array<{ file: string; status: "written" | "unchanged" }> = [];

function applyTarget(file: string, next: string) {
  let old: string | null = null;
  try {
    old = readFileSync(file, "utf8");
  } catch {
    old = null; // 首次生成：文件尚不存在
  }
  if (old === next) {
    results.push({ file, status: "unchanged" });
    return;
  }
  if (verify) {
    console.error(`[tokens] 漂移: ${file}${old === null ? "（文件缺失）" : ""}\n  重新运行 npm run tokens 重新生成。`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(file, next);
  results.push({ file, status: "written" });
}

const webFile = join(repoRoot, "apps", "web", "src", "app", "globals.css");
applyTarget(webFile, replaceTokenBlock(readFileSync(webFile, "utf8"), "web", renderWebBlock()));

const scssFile = join(repoRoot, "apps", "miniapp", "src", "app.scss");
let scss = readFileSync(scssFile, "utf8");
scss = replaceTokenBlock(scss, "page", renderMiniappBlock("page"));
scss = replaceTokenBlock(scss, "light", renderMiniappBlock("light"));
applyTarget(scssFile, scss);

const themeJsonFile = join(repoRoot, "apps", "miniapp", "src", "theme.json");
applyTarget(themeJsonFile, renderWechatThemeJson());

for (const r of results) console.log(`[tokens] ${r.status === "written" ? (verify ? "漂移" : "已写入") : "一致  "} ${r.file.replace(repoRoot, ".")}`);
if (verify && process.exitCode !== 1) console.log("[tokens] verify 通过：全部生成物与源一致。");
