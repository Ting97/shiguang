/**
 * 双 tar 完整发布（docs/08 流程脚本化）：Web 静态 + API standalone 必须同批上线。
 * 背景：手动发布两次漏传 web out 导致整站 404（API 健康而页面 404，具迷惑性）——
 * 本脚本把「备份 → 迁移 → 双 tar + .env + 原子交换 + 冒烟 → 失败自动回滚」固化。
 *
 * REQ-009 FR-F2 强化：
 * - 迁移前置：切换前在服务器执行 db:migrate（迁移幂等，schema_migrations 记账），
 *   消除"代码已上、schema 未迁"的漂移窗口；--skip-migrate 可跳过（应急）。
 * - 备份先行：迁移前服务器侧 pg_dump 快照到 /opt/shiguangri_backups/（保留 7 份轮转）。
 * - 失败自动回滚：冒烟/启动失败时反向 mv 回旧版本并重启，不再只打印提示。
 *
 * 用法：
 *   node scripts/deploy.mjs                       # 构建 → 备份+迁移 → 发布 → 冒烟
 *   node scripts/deploy.mjs --skip-build          # 产物已就绪，只发布（应急）
 *   node scripts/deploy.mjs --skip-build --skip-migrate
 * 前提：本地 out 与 standalone 为最新（脚本会检查存在性，但不判新旧——发布前自行确认已 build）。
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd, opts = {}) =>
  (execSync(cmd, { cwd: ROOT, stdio: opts.quiet ? "pipe" : "inherit", shell: "bash" }) ?? "").toString().trim();

const skipBuild = process.argv.includes("--skip-build");
const skipMigrate = process.argv.includes("--skip-migrate");

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

console.log("[deploy] 服务器侧备份快照（pg_dump + 当前版本，保留 7 份）…");
sh(
  `ssh tencent "mkdir -p /opt/shiguangri_backups && ls -1t /opt/shiguangri_backups/db-*.dump 2>/dev/null | tail -n +8 | xargs -r rm --"`,
  { quiet: true },
);
sh(
  `ssh tencent "sudo -u postgres pg_dump -Fc shiguangri > /opt/shiguangri_backups/db-$(date +%Y%m%d-%H%M%S).dump"`,
  { quiet: true },
);

if (!skipMigrate) {
  console.log("[deploy] 执行数据库迁移（幂等，schema_migrations 记账）…");
  // 迁移在服务器仓库侧执行：迁移脚本随仓库同步（rsync packages/db），不进 standalone 包
  sh(
    `tar czf - -C packages db | ssh tencent "mkdir -p /opt/shiguangri_repo/packages && tar xzf - -C /opt/shiguangri_repo/packages/"`,
    { quiet: true },
  );
  // runner.ts 依赖 pg：服务器 repo 首次无 node_modules（幂等安装，后续为 no-op）
  sh(
    `ssh tencent "cd /opt/shiguangri_repo && [ -d node_modules/pg ] || npm install --no-save --no-audit --no-fund pg"`,
    { quiet: true },
  );
  sh(
    `ssh tencent "cd /opt/shiguangri_repo && DATABASE_URL=\\$(grep -m1 '^DATABASE_URL=' /opt/shiguangri/.env | cut -d= -f2-) npx tsx packages/db/runner.ts"`,
  );
} else {
  console.log("[deploy] --skip-migrate：跳过数据库迁移");
}

console.log("[deploy] 双 tar 上传 …");
sh("tar czf - -C apps/api/.next/standalone . | ssh tencent \"rm -rf /opt/shiguangri_new && mkdir -p /opt/shiguangri_new && tar xzf - -C /opt/shiguangri_new/\"", { quiet: true });
sh("tar czf - -C apps/web out | ssh tencent \"tar xzf - -C /opt/shiguangri_new/apps/api/\"", { quiet: true });

/** 失败回滚：反向 mv + 重启 + 复验（FR-F2：不再只打印提示） */
function rollback(reason) {
  console.error(`[deploy] ✗ ${reason}——自动回滚 …`);
  const active = sh(
    "ssh tencent \"systemctl stop shiguangri && rm -rf /opt/shiguangri_new && [ -d /opt/shiguangri_old ] && mv /opt/shiguangri_old /opt/shiguangri; systemctl start shiguangri && sleep 3 && systemctl is-active shiguangri\"",
    { quiet: true },
  );
  if (active === "active") {
    console.error("[deploy] ✓ 已回滚到上一版本（服务 active）；数据库回退如需，请用 /opt/shiguangri_backups/ 最新 dump 自行恢复");
  } else {
    console.error(`[deploy] ✗ 回滚后服务状态仍异常：${active}——人工介入！备份在 /opt/shiguangri_backups/`);
  }
  process.exit(1);
}

console.log("[deploy] 原子交换 + 重启 …");
const active = sh(
  "ssh tencent \"cp /opt/shiguangri/.env /opt/shiguangri_new/.env && systemctl stop shiguangri && rm -rf /opt/shiguangri_old && mv /opt/shiguangri /opt/shiguangri_old && mv /opt/shiguangri_new /opt/shiguangri && systemctl start shiguangri && sleep 3 && systemctl is-active shiguangri\"",
  { quiet: true },
);
if (active !== "active") rollback(`服务状态异常：${active}`);

console.log("[deploy] 冒烟 …");
const health = sh("curl -s -m 10 https://shiguang.ting97.cn/api/health", { quiet: true });
const loginCode = sh("curl -s -o /dev/null -w '%{http_code}' -m 10 https://shiguang.ting97.cn/login", { quiet: true });
if (!health.includes('"ok":true') || loginCode !== "200") {
  rollback(`冒烟失败：health=${health.slice(0, 80)} login=${loginCode}`);
}
const rev = sh("git log --oneline -1", { quiet: true });
console.log(`[deploy] ✓ 完成：health ok，login 200，当前代码 ${rev}`);
