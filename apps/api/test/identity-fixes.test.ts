/**
 * identity 域修复回归（4-F）：
 * P1 register 邀请码竞态：已用码二次注册被拒；并发复用同一码仅一端建号（事务核销守卫）。
 * P2 verifyCode 一次性原子核销：并发仅一端通过、错码计数、错 5 次作废、过期拒绝、双通道同构。
 * 与 services-smoke 同约定：SHIGUANGRI_TEST_DB 显式指定才动库（不可达整组 skip）；
 * 测试用户/数据用 22260000-… UUID 与 1382226xx/fix2226 专名前缀，幂等清理，可并发重跑。
 * 注意：register 成功路径末尾 createSession 依赖 Next 请求作用域（cookies()），进程内直调
 * 会在「事务已提交后」抛非 ApiError——本文件据此验证提交语义，不视其为失败。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UA = "22260000-1111-4111-8111-111111111111";

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库时不动真实数据库（整组 skip）
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  // 验证码通道/令牌一律未配置：走「邀请码即凭证」确定性分支（零网络；config getter 实时读，删 env 即降级）
  for (const k of [
    "TENCENT_SMS_SECRET_ID", "TENCENT_SMS_SECRET_KEY", "TENCENT_SMS_SDK_APP_ID", "TENCENT_SMS_SIGN", "TENCENT_SMS_TEMPLATE_ID",
    "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "EMAIL_FROM",
    "SETUP_TOKEN",
  ]) delete process.env[k];
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function upsertUser(id: string, nickname: string, role = "user") {
  await pool.query(
    `insert into profiles (id, nickname, role) values ($1,$2,$3)
     on conflict (id) do update set role = excluded.role`,
    [id, nickname, role],
  );
}

/** 幂等清理本文件全部测试数据（profiles 级联 sessions/activities） */
async function cleanup() {
  await pool.query(`delete from invite_codes where code like 'FIX2226%'`, []);
  await pool.query(`delete from sms_codes where phone like '1382226%'`, []);
  await pool.query(`delete from email_codes where email like '%fix2226%'`, []);
  await pool.query(`delete from profiles where phone like '1382226%' or id = $1`, [UA]);
}

const isInviteApiError = (e: any) =>
  e?.name === "ApiError" && e?.status === 400 && /邀请码/.test(String(e?.message));

/* ---------- P1：register 邀请码核销原子性 ---------- */

test("identity-fix：register 邀请码一次核销 + 已用码二次注册被拒 + 播种随事务落库", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  await upsertUser(UA, "fix测试A");
  const { register } = await import("../src/server/identity");
  await pool.query(`insert into invite_codes (code, created_by) values ('FIX2226AA', $1)`, [UA]);

  // 首次注册：事务提交后 createSession 因无请求作用域抛错（预期内），但核销/建号/播种已原子落库
  await assert.rejects(
    () => register({ nickname: "fix一号", phone: "13822260001", password: "password-8", inviteCode: "fix2226aa" }),
    (e: any) => !isInviteApiError(e),
    "首次注册不应在邀请码环节失败",
  );
  const claimed = await pool.query(`select used_by from invite_codes where code = 'FIX2226AA'`);
  assert.ok(claimed.rows[0]?.used_by, "首次注册应已核销邀请码");
  const p1 = await pool.query(`select id from profiles where phone = '13822260001'`);
  assert.equal(p1.rows.length, 1, "首次注册应建号");
  const acts = await pool.query(`select count(*)::int as n from activities where user_id = $1`, [p1.rows[0].id]);
  assert.equal(acts.rows[0].n, 9, "九大预设分类应随同一事务播种");

  // 二次注册同码（无论大小写）→ 前置快查 + 事务守卫双重拦截，且不得建号
  await assert.rejects(
    () => register({ nickname: "fix二号", phone: "13822260002", password: "password-8", inviteCode: "FIX2226AA" }),
    isInviteApiError,
    "已用码二次注册应 400 邀请码错误",
  );
  const p2 = await pool.query(`select id from profiles where phone = '13822260002'`);
  assert.equal(p2.rows.length, 0, "被拒注册不得留下建号半成品");
});

test("identity-fix：并发复用同一邀请码仅一端建号（事务核销守卫）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  await upsertUser(UA, "fix测试A");
  const { register } = await import("../src/server/identity");
  await pool.query(
    `insert into invite_codes (code, created_by) values ('FIX2226CC', $1)
     on conflict (code) do update set used_by = null, used_at = null`,
    [UA],
  );

  // 同码双端并发：两事务都过前置快查，带 used_by is null 守卫的核销只放行一端
  const settled = await Promise.allSettled([
    register({ nickname: "fix并发甲", phone: "13822260003", password: "password-8", inviteCode: "FIX2226CC" }),
    register({ nickname: "fix并发乙", phone: "13822260004", password: "password-8", inviteCode: "FIX2226CC" }),
  ]);
  const reasons = settled.map((r) => (r.status === "rejected" ? r.reason : null));
  assert.ok(
    reasons.some((e) => isInviteApiError(e)),
    "输家应以 ApiError（邀请码已用）回滚",
  );

  const code = await pool.query(`select used_by from invite_codes where code = 'FIX2226CC'`);
  const p3 = await pool.query(`select id from profiles where phone = '13822260003'`);
  const p4 = await pool.query(`select id from profiles where phone = '13822260004'`);
  const createdCount = p3.rows.length + p4.rows.length;
  assert.equal(createdCount, 1, `并发复用同一码至多一端建号（实际 ${createdCount}）`);
  assert.ok(code.rows[0]?.used_by, "邀请码应被核销");
  assert.equal(
    code.rows[0].used_by,
    (p3.rows[0] ?? p4.rows[0]).id,
    "核销归属应与实际建号一致",
  );
});

/* ---------- P2：verifyCode 一次性原子核销 ---------- */

test("identity-fix：verifySmsCode 一次性语义（重放/并发/错码计数/锁定/过期）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { verifySmsCode } = await import("../src/server/identity/sms");
  const { hashToken } = await import("../src/server/identity/auth-crypto");
  const phone = "13822260005";
  await pool.query(`delete from sms_codes where phone = $1`, [phone]);
  const seedCode = async (code: string, opts: { attempts?: number; expired?: boolean } = {}) => {
    await pool.query(
      `insert into sms_codes (phone, code_hash, purpose, expires_at, attempts) values ($1,$2,'login',$3,$4)`,
      [phone, hashToken(code), opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 600_000), opts.attempts ?? 0],
    );
  };

  // 正确 → true；立即重放 → false（行已删，一次性）
  await seedCode("135790");
  assert.equal(await verifySmsCode(phone, "login", "135790"), true, "正确码应通过");
  assert.equal(await verifySmsCode(phone, "login", "135790"), false, "重放同码应失败（一次性）");

  // 并发重放：多端同时提交正确码 → 仅一端通过（原子核销）
  await seedCode("246810");
  const race = await Promise.all([
    verifySmsCode(phone, "login", "246810"),
    verifySmsCode(phone, "login", "246810"),
    verifySmsCode(phone, "login", "246810"),
  ]);
  assert.equal(race.filter(Boolean).length, 1, `并发校验仅一端通过（实际 ${race.filter(Boolean).length}）`);

  // 错码 → false 且累计失败次数；满 5 次后正确码也作废
  await seedCode("111111");
  assert.equal(await verifySmsCode(phone, "login", "999999"), false, "错码应失败");
  const bumped = await pool.query(`select attempts from sms_codes where phone = $1`, [phone]);
  assert.equal(bumped.rows[0].attempts, 1, "错码应累计 attempts");
  await pool.query(`update sms_codes set attempts = 5 where phone = $1`, [phone]);
  assert.equal(await verifySmsCode(phone, "login", "111111"), false, "错 5 次后正确码也应作废");

  // 过期 → 拒绝
  await seedCode("222222", { expired: true });
  assert.equal(await verifySmsCode(phone, "login", "222222"), false, "过期码应拒绝");

  await pool.query(`delete from sms_codes where phone = $1`, [phone]);
});

test("identity-fix：verifyEmailCode 与短信链路同构（一次性 + purpose 隔离）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { verifyEmailCode } = await import("../src/server/identity/email");
  const { hashToken } = await import("../src/server/identity/auth-crypto");
  const email = "user-fix2226@test.local";
  await pool.query(`delete from email_codes where email = $1`, [email]);
  await pool.query(
    `insert into email_codes (email, code_hash, purpose, expires_at) values ($1,$2,'login',$3)`,
    [email, hashToken("654321"), new Date(Date.now() + 600_000)],
  );
  // purpose 不同 → 互不可用（用途隔离）
  assert.equal(await verifyEmailCode(email, "bind", "654321"), false, "bind 用途不应命中 login 验证码");
  assert.equal(await verifyEmailCode(email, "login", "654321"), true, "login 用途应通过");
  assert.equal(await verifyEmailCode(email, "login", "654321"), false, "通过后重放应失败（一次性）");
  const left = await pool.query(`select id from email_codes where email = $1`, [email]);
  assert.equal(left.rows.length, 0, "核销后不留残留行");

  // 通道未配置降级语义保持：configured() = config 通道字段非空（本测试环境删尽了 SMTP/SMS env）
  const { smsConfigured } = await import("../src/server/identity/sms");
  const { emailConfigured } = await import("../src/server/identity/email");
  assert.equal(smsConfigured(), false, "无 TENCENT_SMS_* 时短信通道应降级为未配置");
  assert.equal(emailConfigured(), false, "无 EMAIL_SMTP_* 时邮箱通道应降级为未配置");
});

/* ---------- teardown ---------- */

test("teardown: 清理 identity-fix 测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  assert.ok(true);
});
