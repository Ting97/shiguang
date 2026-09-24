import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { log } from "@/server/platform/http/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health —— 健康检查（REQ-004 FR-G1.2）：只读、不鉴权、不泄敏感信息；供探活与巡检 */
export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, unknown> = {};

  // DB 连通（1s 超时）
  let db = false;
  try {
    await Promise.race([
      pool.query("select 1"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1000)),
    ]);
    db = true;
  } catch {
    db = false;
  }
  checks.db = db;

  // 上传目录可写（生产 /opt/shiguangri_data/uploads；开发 .uploads/；不存在则尝试创建）
  let uploadsWritable = false;
  try {
    const dir = loadConfig().uploadDir || join(process.cwd(), ".uploads");
    await fs.mkdir(dir, { recursive: true });
    const probe = join(dir, `.health-${Date.now()}`);
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    uploadsWritable = true;
  } catch {
    uploadsWritable = false;
  }
  checks.uploadsWritable = uploadsWritable;

  // AI 依赖可用性（只报配置状态，不外呼）
  const cfg = loadConfig();
  checks.aiConfigured = cfg.hasGlmKey;
  checks.jevConfigured = cfg.hasJevKey;

  // 迁移待执行（schema_migrations 存在时比对目录；表不存在=未初始化 runner，不算失败）
  let migrationPending: boolean | null = null;
  try {
    const { rows } = await pool.query(`select count(*)::int as n from schema_migrations`);
    const { readdirSync } = await import("node:fs");
    const dir = join(process.cwd(), "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    migrationPending = rows[0].n < files.length;
  } catch {
    migrationPending = null; // runner 未初始化（035 未跑）——不作为不健康依据
  }
  checks.migrationPending = migrationPending;

  const ok = db && uploadsWritable;
  log.info({ status: ok ? 200 : 503, latencyMs: Date.now() - startedAt, checks }, "health");
  return NextResponse.json(
    { ok, ...checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
