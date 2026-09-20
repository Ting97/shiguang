/**
 * 邮箱验证码：SMTP 发送（nodemailer 懒加载，避免纯静态引入）+ 校验；与短信链路（lib/sms.ts）同构。
 * 未配置 EMAIL_SMTP_* 环境变量时 send 返回 503 语义（通道未开通），不影响邮箱密码登录。
 */
import { pool } from "./db";
import { generateSmsCode, hashToken } from "./auth-crypto";

const CODE_TTL_MS = 10 * 60_000;
const DAILY_LIMIT = 10;

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function emailConfigured(): boolean {
  return Boolean(
    process.env.EMAIL_SMTP_HOST &&
    process.env.EMAIL_SMTP_PORT &&
    process.env.EMAIL_SMTP_USER &&
    process.env.EMAIL_SMTP_PASS &&
    process.env.EMAIL_FROM,
  );
}

export interface EmailSendResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** 发送验证码：限流（同邮箱 60s/次、日 10 条）→ 落库（存 hash）→ SMTP 发送 */
export async function sendEmailCode(email: string, purpose: "login" | "bind"): Promise<EmailSendResult> {
  const recent = await pool.query(
    `select created_at from email_codes
     where email = $1 and purpose = $2 and created_at > now() - interval '60 seconds'`,
    [email, purpose],
  );
  if (recent.rows.length > 0) {
    return { ok: false, status: 429, error: "发送太频繁，请 1 分钟后再试" };
  }
  const today = await pool.query(
    `select count(*)::int as n from email_codes
     where email = $1 and created_at > now() - interval '24 hours'`,
    [email],
  );
  if (today.rows[0].n >= DAILY_LIMIT) {
    return { ok: false, status: 429, error: "今日发送次数已达上限" };
  }

  const code = generateSmsCode();
  const { rows } = await pool.query(
    `insert into email_codes (email, code_hash, purpose, expires_at)
     values ($1,$2,$3,$4) returning id`,
    [email, hashToken(code), purpose, new Date(Date.now() + CODE_TTL_MS)],
  );
  const codeId = rows[0].id;

  if (!emailConfigured()) {
    await pool.query(`delete from email_codes where id = $1`, [codeId]);
    return { ok: false, status: 503, error: "邮箱通道未配置，请使用密码登录" };
  }

  try {
    await smtpSend(email, code);
    return { ok: true, status: 200 };
  } catch (e) {
    await pool.query(`delete from email_codes where id = $1`, [codeId]);
    return { ok: false, status: 502, error: `邮件发送失败：${e instanceof Error ? e.message : e}` };
  }
}

/** 校验验证码：一次性，错 5 次作废 */
export async function verifyEmailCode(email: string, purpose: string, code: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select id, code_hash, attempts, expires_at from email_codes
     where email = $1 and purpose = $2 and expires_at > now()
     order by created_at desc limit 1`,
    [email, purpose],
  );
  const row = rows[0];
  if (!row || row.attempts >= 5) return false;
  if (row.code_hash !== hashToken(code)) {
    await pool.query(`update email_codes set attempts = attempts + 1 where id = $1`, [row.id]);
    return false;
  }
  await pool.query(`delete from email_codes where id = $1`, [row.id]);
  return true;
}

// ---------- SMTP（nodemailer 懒加载） ----------

async function smtpSend(email: string, code: string): Promise<void> {
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.EMAIL_SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "拾光 · 登录验证码",
    text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作请忽略本邮件。`,
  });
}
