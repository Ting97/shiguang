/**
 * 短信验证码：发送（腾讯云 SMS，TC3 签名，零 SDK 依赖）+ 校验
 * 未配置 SMS 环境变量时 send 返回 503 语义（通道未开通），不影响密码登录
 */
import { pool } from "./db";
import { generateSmsCode, hashToken } from "./auth-crypto";

const CODE_TTL_MS = 5 * 60_000;
const _RESEND_INTERVAL_MS = 60_000;
const DAILY_LIMIT = 10;

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TENCENT_SMS_SECRET_ID &&
    process.env.TENCENT_SMS_SECRET_KEY &&
    process.env.TENCENT_SMS_SDK_APP_ID &&
    process.env.TENCENT_SMS_SIGN &&
    process.env.TENCENT_SMS_TEMPLATE_ID,
  );
}

export interface SmsSendResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** 发送验证码：限流（同号 60s/次、日 10 条）→ 落库（存 hash）→ 调通道 */
export async function sendSmsCode(phone: string, purpose: "login" | "bind"): Promise<SmsSendResult> {
  const recent = await pool.query(
    `select created_at from sms_codes
     where phone = $1 and purpose = $2 and created_at > now() - interval '60 seconds'`,
    [phone, purpose],
  );
  if (recent.rows.length > 0) {
    return { ok: false, status: 429, error: "发送太频繁，请 1 分钟后再试" };
  }
  const today = await pool.query(
    `select count(*)::int as n from sms_codes
     where phone = $1 and created_at > now() - interval '24 hours'`,
    [phone],
  );
  if (today.rows[0].n >= DAILY_LIMIT) {
    return { ok: false, status: 429, error: "今日发送次数已达上限" };
  }

  const code = generateSmsCode();
  const { rows } = await pool.query(
    `insert into sms_codes (phone, code_hash, purpose, expires_at)
     values ($1,$2,$3,$4) returning id`,
    [phone, hashToken(code), purpose, new Date(Date.now() + CODE_TTL_MS)],
  );
  const codeId = rows[0].id;

  if (!smsConfigured()) {
    await pool.query(`delete from sms_codes where id = $1`, [codeId]);
    return { ok: false, status: 503, error: "短信通道开通审核中，请先使用密码登录" };
  }

  try {
    await tencentSendSms(phone, code);
    return { ok: true, status: 200 };
  } catch (e) {
    await pool.query(`delete from sms_codes where id = $1`, [codeId]);
    return { ok: false, status: 502, error: `短信发送失败：${e instanceof Error ? e.message : e}` };
  }
}

/** 校验验证码：一次性，错 5 次作废 */
export async function verifySmsCode(phone: string, purpose: string, code: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select id, code_hash, attempts, expires_at from sms_codes
     where phone = $1 and purpose = $2 and expires_at > now()
     order by created_at desc limit 1`,
    [phone, purpose],
  );
  const row = rows[0];
  if (!row || row.attempts >= 5) return false;
  if (row.code_hash !== hashToken(code)) {
    await pool.query(`update sms_codes set attempts = attempts + 1 where id = $1`, [row.id]);
    return false;
  }
  await pool.query(`delete from sms_codes where id = $1`, [row.id]); // 一次性
  return true;
}

// ---------- 腾讯云 SMS（TC3-HMAC-SHA256 手工签名，避免引 SDK） ----------

async function tencentSendSms(phone: string, code: string): Promise<void> {
  const { createHmac, createHash } = await import("node:crypto");
  const secretId = process.env.TENCENT_SMS_SECRET_ID!;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY!;
  const sdkAppId = process.env.TENCENT_SMS_SDK_APP_ID!;
  const sign = process.env.TENCENT_SMS_SIGN!;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID!;

  const host = "sms.tencentcloudapi.com";
  const service = "sms";
  const version = "2021-01-11";
  const region = "ap-guangzhou";
  const action = "SendSms";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: sdkAppId,
    SignName: sign,
    TemplateId: templateId,
    TemplateParamSet: [code, "5"], // 模板参数：验证码、有效分钟数
  });

  const canonicalRequest =
    `POST\n/\n\n${`content-type:application/json\nhost:${host}\n`}\ncontent-type;host\n${createHash("sha256").update(payload).digest("hex")}`;
  const stringToSign =
    `TC3-HMAC-SHA256\n${timestamp}\n${date}/${service}/tc3_request\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;

  const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, "tc3_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
      Authorization:
        `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, ` +
        `SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body: payload,
  });
  const json = (await res.json()) as { Response?: { Error?: { Message: string }; SendStatusSet?: { Code: string; Message: string }[] } };
  const err = json.Response?.Error;
  const sendStatus = json.Response?.SendStatusSet?.[0];
  if (err) throw new Error(err.Message);
  if (sendStatus && !sendStatus.Code.startsWith("Ok")) throw new Error(sendStatus.Message || sendStatus.Code);
}
