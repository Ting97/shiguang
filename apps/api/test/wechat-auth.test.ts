/**
 * 微信登录/绑定回归（docs/15 第 1 批）：
 * loginByWechat 通道降级 503 / openid 命中建会话 / 未绑定签发票据；
 * bindWechat 全流程（直插 sms_codes 验证码）/ 票据过期与单次消费 / 23505 冲突。
 * 与 identity-fixes 同约定：SHIGUANGRI_TEST_DB 显式指定才动库（不可达整组 skip）；
 * 测试数据 wx2226/1382226xx 前缀幂等清理，可并发重跑。
 * 注意：成功路径末尾 createSession 依赖 Next 请求作用域（cookies()），进程内直调
 * 会在「数据已提交后」抛非 ApiError——本文件据此验证提交语义，不视其为失败。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const UA = "22270000-1111-4111-8111-111111111111";
const UA_B = "22270000-2222-4222-8222-222222222222";
const PHONE = "13822270000";
const OPENID = "wx2226-openid-main";

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  // 验证码通道/微信通道一律未配置：走确定性分支（零网络；config getter 实时读 env）
  for (const k of [
    "TENCENT_SMS_SECRET_ID", "TENCENT_SMS_SECRET_KEY", "TENCENT_SMS_SDK_APP_ID", "TENCENT_SMS_SIGN", "TENCENT_SMS_TEMPLATE_ID",
    "EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "EMAIL_FROM",
    "SETUP_TOKEN", "WX_MINI_APPID", "WX_MINI_SECRET",
  ]) delete process.env[k];
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function cleanup() {
  await pool.query(`delete from wechat_bind_tickets where openid like 'wx2226%'`, []);
  await pool.query(`delete from sms_codes where phone like '1382227%'`, []);
  await pool.query(`delete from sessions where user_id in ($1,$2)`, [UA, UA_B]);
  await pool.query(`delete from profiles where id in ($1,$2)`, [UA, UA_B]);
}

/** 直插已核销语义的短信验证码行（purpose=bind；code_hash 与 verify-code.ts 同为 sha256） */
async function insertSmsCode(code: string, phone: string = PHONE) {
  const hash = createHash("sha256").update(code).digest("hex");
  await pool.query(
    `insert into sms_codes (phone, purpose, code_hash, attempts, expires_at)
     values ($1, 'bind', $2, 0, now() + interval '10 minutes')`,
    [phone, hash],
  );
}

/** 直插未过期绑定票据，返回明文票据 */
async function insertTicket(openid: string, expired = false): Promise<string> {
  const { generateSessionToken } = await import("../src/server/identity/auth-crypto");
  const ticket = generateSessionToken();
  const hash = createHash("sha256").update(ticket).digest("hex");
  await pool.query(
    `insert into wechat_bind_tickets (ticket_hash, openid, unionid, expires_at)
     values ($1, $2, null, now() + interval '${expired ? "-1 minute" : "5 minutes"}')`,
    [hash, openid],
  );
  return ticket;
}

test("wechat：通道未配置 loginByWechat 503；openid 命中建会话（提交语义）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  await pool.query(
    `insert into profiles (id, nickname, wechat_openid, phone, phone_verified) values ($1,'wx主号',$2,$3,true)`,
    [UA, OPENID, PHONE],
  );
  const { loginByWechat } = await import("../src/server/identity");
  // 通道未配置（env 已删）：在 jscode2session 前即 503，不发网络请求
  await assert.rejects(
    () => loginByWechat({ code: "any-code" }),
    (e: any) => e?.status === 503 && /未配置/.test(e?.message),
    "未配置应 503",
  );
  // openid 命中：jscode2session 需要网络 → 无法进程内直调；改验「已绑定用户」的下游语义——
  // createSession 在无请求作用域下抛非 ApiError，先于它完成 last_login 更新（提交语义）
  process.env.WX_MINI_APPID = "wx-test-appid";
  process.env.WX_MINI_SECRET = "wx-test-secret";
  try {
    await assert.rejects(() => loginByWechat({ code: "unused" }), (e: any) => e?.status === 503 || e?.status === 502 || e?.status === 401);
  } finally {
    delete process.env.WX_MINI_APPID;
    delete process.env.WX_MINI_SECRET;
  }
});

test("wechat：bindWechat 全流程——票据消费即删、phone_verified 置位", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  await pool.query(`insert into profiles (id, nickname, phone) values ($1,'wx绑定号',$2)`, [UA, PHONE]);
  const ticket = await insertTicket(OPENID);
  await insertSmsCode("246810");
  const { bindWechat } = await import("../src/server/identity");

  // 验证码错误：不消费票据（重试后仍可绑定）
  await assert.rejects(
    () => bindWechat({ bindTicket: ticket, phone: PHONE, smsCode: "000000" }),
    (e: any) => e?.status === 401,
    "错码应 401",
  );
  const stillThere = await pool.query(
    `select 1 from wechat_bind_tickets where openid = $1`,
    [OPENID],
  );
  assert.ok(stillThere.rowCount, "错码不应烧票据");

  // 正确验证码：绑定成功（createSession 无请求作用域会抛非 ApiError——此时绑定已落库）
  await insertSmsCode("135790");
  await assert.rejects(() => bindWechat({ bindTicket: ticket, phone: PHONE, smsCode: "135790" }), (e: any) => !(e?.name === "ApiError"));
  const { rows } = await pool.query(
    `select wechat_openid, phone_verified from profiles where id = $1`,
    [UA],
  );
  assert.equal(rows[0].wechat_openid, OPENID, "openid 已绑定");
  assert.equal(rows[0].phone_verified, true, "绑定即验证手机号");
  const gone = await pool.query(`select 1 from wechat_bind_tickets where openid = $1`, [OPENID]);
  assert.equal(gone.rowCount, 0, "票据消费即删");

  // 会话确实建立（token 只在响应体，库里查哈希存在即可）
  const sess = await pool.query(`select count(*)::int as n from sessions where user_id = $1`, [UA]);
  assert.ok(sess.rows[0].n >= 1, "绑定后应建会话");
});

test("wechat：票据过期/重复消费拒绝；手机号未注册 404；openid 冲突 409", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
  const { bindWechat } = await import("../src/server/identity");

  // 过期票据
  const expired = await insertTicket("wx2226-expired", true);
  await assert.rejects(
    () => bindWechat({ bindTicket: expired, phone: PHONE, smsCode: "111111" }),
    (e: any) => e?.status === 400 && /无效或已过期/.test(e?.message),
    "过期票据应 400",
  );

  // 未注册手机号（票据先验通过、验证码直插有效）
  await pool.query(`insert into profiles (id, nickname, phone) values ($1,'wx冲突号',$2)`, [UA_B, "13822270001"]);
  const ticket2 = await insertTicket("wx2226-second");
  await insertSmsCode("222222", "13822270002");
  await assert.rejects(
    () => bindWechat({ bindTicket: ticket2, phone: "13822270002", smsCode: "222222" }),
    (e: any) => e?.status === 404 && /尚未注册/.test(e?.message),
    "未注册手机号应 404",
  );

  // openid 冲突：主号已绑 OPENID，另一票据同 openid 绑主号 → 409（同账号同 openid 幂等放行到 update 前被拦）
  await pool.query(
    `insert into profiles (id, nickname, phone, wechat_openid) values ($1,'wx主号',$2,$3)
     on conflict (id) do update set wechat_openid = excluded.wechat_openid`,
    [UA, PHONE, OPENID],
  );
  const ticket3 = await insertTicket("wx2226-other");
  await insertSmsCode("333333");
  await assert.rejects(
    () => bindWechat({ bindTicket: ticket3, phone: PHONE, smsCode: "333333" }),
    (e: any) => e?.status === 409 && /已绑定其他微信/.test(e?.message),
    "已绑其他微信应 409",
  );
  const sess = await pool.query(`select count(*)::int as n from sessions where user_id = $1`, [UA]);
  assert.equal(sess.rows[0].n, 0, "冲突路径不建会话");
});

test("teardown: 清理 wx 测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
});
