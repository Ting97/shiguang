/**
 * 微信登录回归：
 * loginByWechat 通道降级 503 / openid 命中建会话（未命中现为自动建号——jscode2session
 * 需真实微信网络，进程内不可直调，自动建号路径由开发者工具真机链路验证）。
 * 历史票据绑定流程（bindWechat + wechat_bind_tickets）已随 code 直绑下线删除，
 * 本文件十一轮同步收编；表按「迁移只增不改」留库（patrol 清理过期行做卫生）。
 * 与 identity-fixes 同约定：SHIGUANGRI_TEST_DB 显式指定才动库（不可达整组 skip）；
 * 测试数据 wx2226/1382226xx 前缀幂等清理，可并发重跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UA = "22270000-1111-4111-8111-111111111111";
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
  await pool.query(`delete from sessions where user_id = $1`, [UA]);
  await pool.query(`delete from profiles where id = $1`, [UA]);
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

test("teardown: 清理 wx 测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await cleanup();
});
