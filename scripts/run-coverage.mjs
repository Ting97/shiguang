/**
 * 覆盖率门槛（REQ-004 FR-F1.4 / AC-5）：核心四模块（identity/finance/timeline/ai）行覆盖 ≥60%。
 * 流程：解析测试库连接串 → c8 包裹进程内测试（单测 + services 冒烟）→ check-coverage 红不过。
 * 测试库缺失时本地一次性建：createdb shiguangri_test && npm run db:migrate -- --fresh
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const testDb =
  process.env.SHIGUANGRI_TEST_DB ??
  readFileSync(join(root, ".env"), "utf8")
    .match(/^DATABASE_URL=(.+)$/m)?.[1].trim() // 锚定行首：注释行（# DATABASE_URL=...）不再抢先命中
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
  // Node 20 的 --test 不识别 glob、Windows cmd 也不展开 test/*.test.ts——脚本内显式展开（engines 声明 node>=20）
  const testFiles = readdirSync(join(root, "apps/api", "test"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `test/${f}`)
    .join(" ");
  execSync(`npx c8 --no-clean --reporter=none npx tsx --test --test-concurrency=1 ${testFiles}`, {
    cwd: join(root, "apps/api"),
    stdio: "inherit",
    env,
    shell: "bash",
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
