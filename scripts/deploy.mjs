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
    // tsx 钉版本：未钉的 npx 现场解析会随 registry 波动（网络抖动=迁移步卡死，发布失败）
    `ssh tencent "cd /opt/shiguangri_repo && DATABASE_URL=\\$(grep -m1 '^DATABASE_URL=' /opt/shiguangri/.env | cut -d= -f2-) npx -y tsx@4.23.13 packages/db/runner.ts"`,
  );
} else {
  console.log("[deploy] --skip-migrate：跳过数据库迁移");
}

console.log("[deploy] 双 tar 上传 …");
sh("tar czf - -C apps/api/.next/standalone . | ssh tencent \"rm -rf /opt/shiguangri_new && mkdir -p /opt/shiguangri_new && tar xzf - -C /opt/shiguangri_new/\"", { quiet: true });
sh("tar czf - -C apps/web out | ssh tencent \"tar xzf - -C /opt/shiguangri_new/apps/api/\"", { quiet: true });

/** 失败回滚：反向 mv + 重启 + 复验（FR-F2：不再只打印提示）
 *  状态安全要点：
 *  - 只有确认 /opt/shiguangri_old 备份存在时才动当前目录（交换早期失败时当前目录是唯一好版本，绝不能删）
 *  - POSIX mv 目标存在时会把源移进其内部——必须先挪走当前目录再 mv，不能直接 mv 覆盖
 *  - 坏版本保留为 /opt/shiguangri_failed 供事后分析（下次部署会被覆盖） */
function rollback(reason) {
  console.error(`[deploy] ✗ ${reason}——自动回滚 …`);
  const script = [
    "systemctl stop shiguangri",
    "rm -rf /opt/shiguangri_new",
    "if [ -d /opt/shiguangri_old ]; then",
    "  if [ -d /opt/shiguangri ]; then rm -rf /opt/shiguangri_failed; mv /opt/shiguangri /opt/shiguangri_failed; fi",
    "  rm -rf /opt/shiguangri",
    "  mv /opt/shiguangri_old /opt/shiguangri",
    "fi",
    "systemctl start shiguangri && sleep 3 && systemctl is-active shiguangri",
  ].join("; ");
  let active = "";
  try {
    active = sh(`ssh tencent "${script}"`, { quiet: true });
  } catch (e) {
    console.error(`[deploy] ✗ 回滚命令本身失败：${e.message?.slice(0, 200)}`);
  }
  if (active === "active") {
    console.error("[deploy] ✓ 已回滚到上一版本（服务 active）；数据库回退如需，请用 /opt/shiguangri_backups/ 最新 dump 自行恢复");
  } else {
    console.error(`[deploy] ✗ 回滚后服务状态仍异常：${active || "(命令失败)"}——人工介入！备份在 /opt/shiguangri_backups/`);
  }
  process.exit(1);
}

console.log("[deploy] 原子交换 + 重启 …");
let active;
try {
  active = sh(
    "ssh tencent \"cp /opt/shiguangri/.env /opt/shiguangri_new/.env && systemctl stop shiguangri && rm -rf /opt/shiguangri_old && mv /opt/shiguangri /opt/shiguangri_old && mv /opt/shiguangri_new /opt/shiguangri && systemctl start shiguangri && sleep 3 && systemctl is-active shiguangri\"",
    { quiet: true },
  );
} catch (e) {
  // 交换中途断连：服务可能已 stop、目录可能已 mv 一半——必须走回滚而非裸崩
  rollback(`交换命令失败：${e.message?.slice(0, 200)}`);
}
if (active !== "active") rollback(`服务状态异常：${active}`);

console.log("[deploy] 冒烟 …");
// 冷启动就绪可能慢于 sleep 3：单次 curl 失败即回滚会误杀好版本——各最多探 3 次（间隔 3s），任一次成功即过
async function smoke(label, cmd, check) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      last = sh(cmd, { quiet: true });
    } catch (e) {
      last = String(e.message).slice(0, 80); // curl 连接失败/超时非零退出会让 execSync 抛错，视为该次未过
    }
    if (check(last)) return { ok: true, out: last };
    console.log(`[deploy] 冒烟第 ${attempt}/3 次未过（${label}）${attempt < 3 ? "，3s 后重试" : ""}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, out: last };
}
const health = await smoke("health", "curl -s -m 10 https://shiguang.ting97.cn/api/health", (o) => o.includes('"ok":true'));
const login = await smoke("login", "curl -s -o /dev/null -w '%{http_code}' -m 10 https://shiguang.ting97.cn/login", (o) => o === "200");
// 鉴权 API 探测：未带凭证必须 401——middleware/会话链路被打挂时 health/login 仍全绿（「API 健康而页面 404」的对称缺口）
const meAuth = await smoke(
  "auth/me(401)",
  "curl -s -o /dev/null -w '%{http_code}' -m 10 https://shiguang.ting97.cn/api/auth/me",
  (o) => o === "401",
);
if (!health.ok || !login.ok || !meAuth.ok) {
  rollback(`冒烟失败：health=${health.out.slice(0, 80)} login=${login.out} me=${meAuth.out}`);
}
const rev = sh("git log --oneline -1", { quiet: true });
console.log(`[deploy] ✓ 完成：health ok，login 200，me 401，当前代码 ${rev}`);
