/**
 * 邮箱验证码：SMTP 发送（nodemailer 懒加载，避免纯静态引入）+ 校验；与短信链路（lib/sms.ts）同构。
 * 未配置 EMAIL_SMTP_* 环境变量时 send 返回 503 语义（通道未开通），不影响邮箱密码登录。
 */
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { generateSmsCode, hashToken } from "@/server/identity/auth-crypto";
import { verifyCode } from "@/server/identity/verify-code";

const CODE_TTL_MS = 10 * 60_000;
const DAILY_LIMIT = 10;

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function emailConfigured(): boolean {
  return loadConfig().smtp !== null;
}

export interface EmailSendResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** 发送验证码：限流（同邮箱 60s/次、日 10 条）→ 落库（存 hash）→ SMTP 发送 */
export async function sendEmailCode(email: string, purpose: "login" | "bind"): Promise<EmailSendResult> {
  // 同 sms 口径：advisory lock 串行化同邮箱并发后再判定（check-then-insert 并发穿透封堵）
  const code = generateSmsCode();
  const client = await pool.connect();
  let codeId: string | null = null;
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`email-code:${email}`]);
    const recent = await client.query(
      `select 1 from email_codes
       where email = $1 and purpose = $2 and created_at > now() - interval '60 seconds' limit 1`,
      [email, purpose],
    );
    if (recent.rows.length > 0) {
      await client.query("commit");
      return { ok: false, status: 429, error: "发送太频繁，请 1 分钟后再试" };
    }
    const today = await client.query(
      `select count(*)::int as n from email_codes
       where email = $1 and created_at > now() - interval '24 hours'`,
      [email],
    );
    if (today.rows[0].n >= DAILY_LIMIT) {
      await client.query("commit");
      return { ok: false, status: 429, error: "今日发送次数已达上限" };
    }
    codeId = (
      await client.query(
        `insert into email_codes (email, code_hash, purpose, expires_at)
         values ($1,$2,$3,$4) returning id`,
        [email, hashToken(code), purpose, new Date(Date.now() + CODE_TTL_MS)],
      )
    ).rows[0].id;
    await client.query("commit");
  } finally {
    client.release();
  }

  if (!emailConfigured()) {
    await pool.query(`delete from email_codes where id = $1`, [codeId]);
    return { ok: false, status: 503, error: "邮箱通道未配置，请使用密码登录" };
  }

  try {
    await smtpSend(email, code);
    return { ok: true, status: 200 };
  } catch (e) {
    await pool.query(`delete from email_codes where id = $1`, [codeId]);
    // 同 sms 口径：SMTP 原始错误只进日志
    console.warn(`[email] 发送失败: ${String(e).slice(0, 300)}`);
    return { ok: false, status: 502, error: "验证码发送失败，请稍后重试" };
  }
}

/** 校验验证码：一次性原子核销（与短信链路共享 verify-code，错 5 次作废） */
export async function verifyEmailCode(email: string, purpose: string, code: string): Promise<boolean> {
  return verifyCode("email_codes", email, purpose, code);
}

// ---------- SMTP（nodemailer 懒加载） ----------

async function smtpSend(email: string, code: string): Promise<void> {
  const smtp = loadConfig().smtp!;
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    // 上游 SMTP 挂起时显式超时（不依赖默认无限等待）
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject: "拾光 · 登录验证码",
    text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作请忽略本邮件。`,
  });
}
