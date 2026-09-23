/**
 * 配额口径修复回归（quota.ts）：审计行计数 = parse/review/asr 全阶段且 ok 的成功调用。
 * - rules-only parse（model=''，ok=true）计 1 次，不双计（space_classify 不计）、失败不扣
 * - jev% 模型行继续排除；窗口外（>30 天）不计
 * 与 services-smoke 共用测试库约定（SHIGUANGRI_TEST_DB），不可达整组 skip；
 * 用户 UUID 用 22270000- 前缀，并发 agent 共库时偶发冲突重跑即可。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UID = "22270000-0000-4000-8000-0000000000a1";

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function insAudit(stage: string, model: string | null, ok: boolean, createdAt?: Date) {
  await pool.query(
    `insert into audit_logs (user_id, stage, model, ok, created_at) values ($1,$2,$3,$4,coalesce($5, now()))`,
    [UID, stage, model ?? "", ok, createdAt ?? null],
  );
}

test("quota：口径 = parse/review/asr 成功调用（不双计/失败不扣/jev 排除/窗口外不计）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from audit_logs where user_id = any($1)`, [[UID]]);
  await pool.query(
    `insert into profiles (id, nickname) values ($1,'quota修复测试') on conflict (id) do nothing`,
    [UID],
  );

  const { getQuota, checkAiQuota, FREE_AI_CALLS_30D } = await import("../src/server/ai");
  assert.equal((await getQuota(UID)).used, 0, "清理后窗口内应为 0");

  // 计入：rules-only parse（model=''）、GLM parse、review、asr —— 各 1 次
  await insAudit("parse", "", true); // 纯规则兜底也是一次成功的 parse 尝试
  await insAudit("parse", "glm-5.3-flash", true);
  await insAudit("review", "glm-5.3-flash", true);
  await insAudit("asr", "glm-asr-2512", true);
  // 不计入：LLM 失败、旁路 stage、jev 模型、30 天窗口外
  await insAudit("parse", "glm-5.3-flash", false); // LLM 调用失败不扣
  await insAudit("space_classify", "glm-5.3-flash", true); // 旁路阶段（旧口径曾与 parse 双计）
  await insAudit("jev_shadow", "jev-latest", true);
  await insAudit("chat", "glm-5.3-flash", true);
  await insAudit("parse", "jev-latest", true); // 计数 stage 里的 jev% 行仍排除
  await insAudit("parse", "glm-5.3-flash", true, new Date(Date.now() - 31 * 86_400_000));
  await insAudit("review", "glm-5.3-flash", false); // review 失败同样不扣

  const q = await getQuota(UID);
  assert.equal(q.plan, "free");
  assert.equal(q.limit, FREE_AI_CALLS_30D);
  assert.equal(q.used, 4, `应恰好计 4 次，实际 ${q.used}`);
  assert.equal((await checkAiQuota(UID)).allowed, true);

  // 顶到上限：再补 26 行 → used=30 → allowed=false
  await pool.query(
    `insert into audit_logs (user_id, stage, model, ok)
     select $1, 'parse', '', true from generate_series(1, 26)`,
    [UID],
  );
  const full = await checkAiQuota(UID);
  assert.equal(full.used, 30);
  assert.equal(full.allowed, false, "30 天窗口内 30 次后应拒绝（402 语义）");

  await pool.query(`delete from audit_logs where user_id = any($1)`, [[UID]]);
  await pool.query(`delete from profiles where id = $1`, [UID]);
});
