/**
 * 70 路由三层冒烟编排（npm run test:routes）：
 *   1. 解析测试库连接串（SHIGUANGRI_TEST_DB 优先，否则取根 .env 的 DATABASE_URL 库名替换为 shiguangri_test）
 *   2. 起隔离的 next dev 服务（3123 端口，DATABASE_URL=测试库，AUTH_DISABLED=0 真实鉴权链路）
 *   3. 等 /api/health 就绪 → 跑 test/routes-smoke.test.ts → 杀进程
 * 前置一次性建库：createdb shiguangri_test && npm run db:migrate -- --fresh（DATABASE_URL 指向测试库）
 */
import { readFileSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;

const envDb = process.env.SHIGUANGRI_TEST_DB;
const testDb =
  envDb ??
  readFileSync(join(root, ".env"), "utf8")
    .match(/DATABASE_URL=(.*)/)?.[1]
    ?.trim()
    .replace(/^"|"$/g, "")
    .replace(/\/[^/]+$/, "/shiguangri_test");

if (!testDb) {
  console.error("[smoke] 未找到测试库连接串（SHIGUANGRI_TEST_DB 或 .env DATABASE_URL）");
  process.exit(1);
}

const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  cwd: join(root, "apps/api"),
  env: { ...process.env, DATABASE_URL: testDb, AUTH_DISABLED: "0" },
  shell: process.platform === "win32",
  stdio: "ignore",
});

const cleanup = () => {
  try {
    // Windows：npx→cmd→next 进程树，按端口杀最可靠
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`).toString();
      const pids = [...new Set(out.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean))];
      for (const pid of pids) execSync(`taskkill /F /PID ${pid}`);
    } else {
      server.kill("SIGTERM");
    }
  } catch {
    /* 端口已释放 */
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

// 等健康检查（dev 冷启动含编译，上限 3 分钟）
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const r = await fetch(`${BASE}/api/health`);
    up = r.ok;
  } catch {
    up = false;
  }
}
if (!up) {
  console.error("[smoke] 服务 3 分钟内未就绪，放弃");
  process.exit(1);
}
console.log(`[smoke] 服务就绪 ${BASE}（测试库已注入）`);

let code = 1;
try {
  execSync("npx tsx --test test/routes-smoke.test.ts", {
    cwd: join(root, "apps/api"),
    stdio: "inherit",
    env: { ...process.env, SHIGUANGRI_TEST_DB: testDb, SHIGUANGRI_SMOKE_BASE: BASE },
  });
  code = 0;
} catch (e) {
  code = e.status ?? 1;
} finally {
  cleanup();
}
process.exit(code);
