/**
 * 构建期生成迁移清单（REQ-009 FR-F4）：把 packages/db/migrations 的 .sql 数量写进
 * .next/migrations-manifest.json，standalone 产物携带；/api/health 据此判断迁移待执行。
 * （原实现读 process.cwd()/migrations——该目录在 dev 与 standalone 下都不存在，检查恒 null。）
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "..", "packages", "db", "migrations");
// 过滤口径必须与 packages/db/runner.ts 一致（严格 NNN-name.sql）——manifest 若按裸 .sql 统计，
// 一个手滑命名的 65-fix.sql 就会让「已应用 < 清单数」→ /api/health 永久 migrationPending
const count = readdirSync(migrationsDir).filter((f) => /^\d{3}-.+\.sql$/.test(f)).length;
const stamp = new Date().toISOString();
// 写两处：dev 读 apps/api/.next/；standalone 运行时 cwd 是 .../standalone/apps/api，
// 其 .next/ 只含打包所需文件（不自动带上根 .next/ 的自定义 json），须显式落一份
const targets = [
  join(here, "..", ".next", "migrations-manifest.json"),
  join(here, "..", ".next", "standalone", "apps", "api", ".next", "migrations-manifest.json"),
];
for (const out of targets) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ count, generatedAt: stamp }));
  console.log(`[migrations-manifest] ${count} migrations -> ${out}`);
}
