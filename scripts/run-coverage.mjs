/**
 * 覆盖率门槛（REQ-004 FR-F1.4 / AC-5）：核心四模块（identity/finance/timeline/ai）行覆盖 ≥60%。
 * 流程：解析测试库连接串 → c8 包裹进程内测试（单测 + services 冒烟）→ check-coverage 红不过。
 * 测试库缺失时本地一次性建：createdb shiguangri_test && npm run db:migrate -- --fresh
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const testDb =
  process.env.SHIGUANGRI_TEST_DB ??
  readFileSync(join(root, ".env"), "utf8")
    .match(/DATABASE_URL=(.*)/)?.[1]
    ?.trim()
    .replace(/^"|"$/g, "")
    .replace(/\/[^/]+$/, "/shiguangri_test");

if (!testDb) {
  console.error("[coverage] 未找到测试库连接串（SHIGUANGRI_TEST_DB 或 .env DATABASE_URL）");
  process.exit(1);
}

const env = {
  ...process.env,
  SHIGUANGRI_TEST_DB: testDb,
  NODE_V8_COVERAGE: join(root, "coverage-tmp"),
};

try {
  execSync("npx c8 --no-clean --reporter=none npx tsx --test --test-concurrency=1 test/*.test.ts", {
    cwd: join(root, "apps/api"),
    stdio: "inherit",
    env,
  });
} finally {
  // routes-smoke（E2E）在无服务环境下自动 skip，不参与覆盖；这里只对四核心模块出报告并卡门槛
  execSync(
    "npx c8 report --temp-directory coverage-tmp" +
      ' --include "**/src/server/identity/**" --include "**/src/server/finance/**"' +
      ' --include "**/src/server/timeline/**" --include "**/src/server/ai/**"' +
      " --reporter=text --check-coverage --lines 60",
    { cwd: root, stdio: "inherit", env: { ...process.env, NODE_V8_COVERAGE: join(root, "coverage-tmp") } },
  );
}
