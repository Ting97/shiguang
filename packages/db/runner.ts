/**
 * 迁移运行器（REQ-004 FR-A3 / 004 4-A）：终结手工 psql。
 *   npm run db:migrate          增量执行 packages/db/migrations/*.sql 中未跑的
 *   npm run db:migrate -- --status   只看差异不执行
 * - 记录表 schema_migrations（035）；已执行文件的 checksum 变更即报错（防手改已上线迁移）
 * - 首跑自举：表为空且已有业务表（profiles 存在）时把既有全部迁移按序回填（applied_by='backfill'），不重复执行；
 *   真空库（无业务表）直接报错退出，须 --fresh 全量执行（防空库被回填成"已应用"的单向门）
 * - 连接串取 DATABASE_URL；单条迁移整体事务执行，失败即停
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");
const statusOnly = process.argv.includes("--status");
// 空库全量真实执行（测试库/新环境初始化）——与自举回填的区别是 SQL 真正落库
const freshApply = process.argv.includes("--fresh");

const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** 迁移文件自带事务语句会让 runner 的「单条迁移整体事务」契约失效：
 *  文件内 commit; 会把外层事务提前提交，之后的记录表 insert 变成 autocommit——
 *  中间失败即「已执行但未记录」，下次重跑非幂等迁移直接踩坏数据。统一由 runner 管理事务 */
function assertNoInlineTx(sql: string, f: string) {
  if (/^\s*(begin|start\s+transaction|commit|rollback)\s*;/im.test(sql)) {
    console.error(`[migrate] ✗ ${f} 自带 begin/commit 语句——事务由 runner 统一管理，请移除文件内事务语句`);
    process.exit(1);
  }
}

async function ensureTable() {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now(),
      checksum   text,
      applied_by text not null default 'runner'
    )`);
}

async function applied(): Promise<Map<string, string | null>> {
  const { rows } = await client.query(`select filename, checksum from schema_migrations`);
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

async function main() {
  await client.connect();
  await ensureTable();
  // 并发防护：CI/CD 与开发者同时跑 db:migrate 会双双判定同一 pending 并重复执行（会话级锁，断开自动释放）
  await client.query(`select pg_advisory_lock(hashtext('shiguangri-migrate'))`);
  const done = await applied();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 文件名序即执行序（NNN-name.sql）

  // 空库 + --fresh：schema.sql 建基线 + 全量迁移真实执行（测试库/新环境初始化）
  if (done.size === 0 && files.length > 0 && freshApply) {
    const baseSql = readFileSync(join(here, "schema.sql"), "utf8");
    await client.query("begin");
    await client.query(baseSql);
    await client.query("commit");
    console.log("[migrate] ✓ schema.sql（基线 DDL）");
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      // legacy 迁移（003）自带 begin/commit：仅 fresh 全量执行时剥离、由 runner 事务托管
      //（文件内容不动，checksum 不受影响）；新迁移走 pending 路径的硬校验
      const execSql = sql.replace(/^\s*(begin|start\s+transaction|commit|rollback)\s*;.*$/gim, "");
      const t0 = Date.now();
      try {
        await client.query("begin");
        await client.query(execSql);
        await client.query(`insert into schema_migrations (filename, checksum) values ($1,$2)`, [
          f,
          sha256(sql),
        ]);
        await client.query("commit");
        console.log(`[migrate] ✓ ${f}（${Date.now() - t0}ms）`);
      } catch (e) {
        await client.query("rollback").catch(() => {});
        console.error(`[migrate] ✗ ${f} 失败：${String(e).slice(0, 300)}`);
        process.exit(1);
      }
    }
    console.log(`[migrate] fresh 完成：全量执行 ${files.length} 个`);
    return;
  }

  // 首跑自举：记录表为空但目录里有历史迁移 → 全部回填（不执行——库已含其效果）
  if (done.size === 0 && files.length > 0) {
    if (statusOnly) {
      console.log(`[migrate] 未初始化：${files.length} 个既有迁移待回填（执行 db:migrate 完成回填）`);
      return;
    }
    // 单向门守卫：连 profiles 都没有 = 真空库（测试/新环境忘加 --fresh）。静默回填会让零业务表的库
    // 假装"迁移已应用"，且 --fresh（要求记录表为空）从此永久跳过——必须显式 --fresh 全量执行。
    const probe = await client.query(`select to_regclass('public.profiles') as t`);
    if (!probe.rows[0]?.t) {
      console.error("[migrate] 检测到空库（无 public.profiles 业务表）：测试/新库请使用 --fresh 全量执行：npm run db:migrate -- --fresh");
      process.exit(1);
    }
    for (const f of files) {
      const checksum = sha256(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      await client.query(
        `insert into schema_migrations (filename, checksum, applied_by) values ($1,$2,'backfill')
         on conflict (filename) do nothing`,
        [f, checksum],
      );
    }
    console.log(`[migrate] 自举回填 ${files.length} 个既有迁移（未重复执行）`);
    return;
  }

  const pending = files.filter((f) => !done.has(f));
  if (statusOnly) {
    console.log(`[migrate] 已应用 ${done.size} / 共 ${files.length}，待执行 ${pending.length}`);
    for (const f of pending) console.log(`  pending: ${f}`);
    // --status 同样做 checksum 比对：运维看"待执行 0"时也要能看到已上线文件被手改
    for (const [f, ck] of done) {
      if (files.includes(f) && ck) {
        const now = sha256(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
        if (now !== ck) console.error(`[migrate] ⚠ 迁移文件已变更但曾应用：${f}`);
      }
    }
    return;
  }

  // checksum 防篡改：已应用文件内容变化即报错
  for (const [f, ck] of done) {
    if (files.includes(f) && ck) {
      const now = sha256(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      if (now !== ck) {
        console.error(`[migrate] 迁移文件已变更但曾应用：${f} —— 禁止手改已上线迁移，请以新编号新增`);
        process.exit(1);
      }
    }
  }

  if (pending.length === 0) {
    console.log(`[migrate] 已是最新（${done.size} 个迁移）`);
    return;
  }

  for (const f of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const checksum = sha256(sql);
    assertNoInlineTx(sql, f);
    const t0 = Date.now();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        `insert into schema_migrations (filename, checksum) values ($1,$2)`,
        [f, checksum],
      );
      await client.query("commit");
      console.log(`[migrate] ✓ ${f}（${Date.now() - t0}ms）`);
    } catch (e) {
      await client.query("rollback").catch(() => {});
      console.error(`[migrate] ✗ ${f} 失败：${String(e).slice(0, 300)}`);
      process.exit(1);
    }
  }
  console.log(`[migrate] 完成：本次执行 ${pending.length} 个`);
}

main()
  .catch((e) => {
    console.error(`[migrate] 连接/初始化失败：${String(e).slice(0, 200)}`);
    process.exit(1);
  })
  .finally(() => client.end());
