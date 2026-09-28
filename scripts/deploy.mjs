/**
 * 双 tar 完整发布（docs/08 流程脚本化）：Web 静态 + API standalone 必须同批上线。
 * 背景：手动发布两次漏传 web out 导致整站 404（API 健康而页面 404，具迷惑性）——
 * 本脚本把「双 tar + .env + 原子交换 + 冒烟」固化，任一产物缺失即拒绝发布。
 *
 * 用法：
 *   node scripts/deploy.mjs              # 构建 → 发布 → 冒烟（标准流程）
 *   node scripts/deploy.mjs --skip-build # 产物已就绪，只发布（应急）
 * 前提：本地 out 与 standalone 为最新（脚本会检查存在性，但不判新旧——发布前自行确认已 build）。
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", shell: "bash" }).toString().trim();

const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  console.log("[deploy] 构建 web + api …");
  sh("npm run build");
}

const STANDALONE = join(ROOT, "apps/api/.next/standalone/apps/api/server.js");
const OUT = join(ROOT, "apps/web/out/index.html");
for (const [label, p] of [
  ["API standalone", STANDALONE],
  ["Web 静态导出", OUT],
]) {
  if (!existsSync(p)) {
    console.error(`[deploy] ✗ 缺少${label}（${p}）——先构建再发布，拒绝半包上线`);
    process.exit(1);
  }
}

console.log("[deploy] 双 tar 上传 …");
sh("tar czf - -C apps/api/.next/standalone . | ssh tencent \"rm -rf /opt/shiguangri_new && mkdir -p /opt/shiguangri_new && tar xzf - -C /opt/shiguangri_new/\"", { quiet: true });
sh("tar czf - -C apps/web out | ssh tencent \"tar xzf - -C /opt/shiguangri_new/apps/api/\"", { quiet: true });

console.log("[deploy] 原子交换 + 重启 …");
const active = sh(
  "ssh tencent \"cp /opt/shiguangri/.env /opt/shiguangri_new/.env && systemctl stop shiguangri && rm -rf /opt/shiguangri_old && mv /opt/shiguangri /opt/shiguangri_old && mv /opt/shiguangri_new /opt/shiguangri && systemctl start shiguangri && sleep 3 && systemctl is-active shiguangri\"",
  { quiet: true },
);
if (active !== "active") {
  console.error(`[deploy] ✗ 服务状态异常：${active}（回滚：反向 mv /opt/shiguangri_old）`);
  process.exit(1);
}

console.log("[deploy] 冒烟 …");
const health = sh("curl -s -m 10 https://shiguang.ting97.cn/api/health", { quiet: true });
const loginCode = sh("curl -s -o /dev/null -w '%{http_code}' -m 10 https://shiguang.ting97.cn/login", { quiet: true });
if (!health.includes('"ok":true') || loginCode !== "200") {
  console.error(`[deploy] ✗ 冒烟失败：health=${health.slice(0, 80)} login=${loginCode}（回滚：反向 mv /opt/shiguangri_old）`);
  process.exit(1);
}
const rev = sh("git log --oneline -1", { quiet: true });
console.log(`[deploy] ✓ 完成：health ok，login 200，当前代码 ${rev}`);
