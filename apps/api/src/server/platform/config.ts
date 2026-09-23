/**
 * 平台基建：env 集中读取与启动校验（REQ-004 FR-A2.1/A2.2）。
 * - 全仓禁止散读 process.env（ESLint no-restricted-imports/圈禁约定），统一经此模块
 * - initConfig() 在 instrumentation 启动时调用一次：fail-fast——缺失必需项列清单退出；
 *   生产环境 AUTH_DISABLED 非空即拒绝启动、弱默认连接串须显式 ALLOW_INSECURE=1 越过
 */
import { GLM_DEFAULT_BASE_URL, GLM_DEFAULT_MODEL } from "@shiguangri/ai";

/** SMTP 邮件通道（EMAIL_SMTP_* 五项任缺视为通道未开通，业务侧降级） */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** 腾讯云 SMS 通道（TENCENT_SMS_* 五项任缺视为通道未开通，业务侧降级） */
export interface SmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  sign: string;
  templateId: string;
}

export interface AppConfig {
  env: "development" | "production" | "test";
  isProd: boolean;
  databaseUrl: string;
  uploadDir: string | null;
  glmModel: string;
  glmBaseUrl: string;
  jevModel: string;
  /** Jev 模式默认值（运行时实际生效值由 app_config 覆盖优先，见 lib/ai-mode） */
  jevMode: "off" | "shadow" | "on";
  hasGlmKey: boolean;
  hasJevKey: boolean;
  // ---------- 运行时开关/通道：getter 实时读 env（测试可运行中切换；启动期 fail-fast 见 loadConfig 内校验） ----------
  /** 万能后门（AUTH_DISABLED=1）：仅限本地开发；生产非空由 loadConfig 拒绝启动 */
  readonly authDisabled: boolean;
  /** setup 一次性令牌（FR-C2.3）：未配置 = null → 门禁直通 */
  readonly setupToken: string | null;
  /** 会话 cookie secure 位：NODE_ENV=production（与历史行为一致，勿改用 APP_ENV） */
  readonly secureCookie: boolean;
  /** SMTP 通道，未配置 = null */
  readonly smtp: SmtpConfig | null;
  /** 腾讯云 SMS 通道，未配置 = null */
  readonly sms: SmsConfig | null;
}

class ConfigValidationError extends Error {
  constructor(public issues: string[]) {
    super(`配置校验失败：\n- ${issues.join("\n- ")}`);
    this.name = "ConfigValidationError";
  }
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const envRaw = process.env.NODE_ENV ?? "development";
  const env = envRaw === "production" ? "production" : envRaw === "test" ? "test" : "development";
  // 生产判定用显式 APP_ENV 而非 NODE_ENV：standalone 构建的 NODE_ENV 恒为 production，
  // 而本地标准测试流程（AUTH_DISABLED 跑生产构建）必须不受影响（004 实施修正，回写 02 §3.3）
  const isProd = process.env.APP_ENV === "production";
  const issues: string[] = [];

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) issues.push("缺少 DATABASE_URL（PostgreSQL 连接串）");
  // 弱默认口令拦截（FR-A2.2）：生产库不允许带常见示例弱口令；ALLOW_INSECURE=1 显式越过
  if (databaseUrl && /:postgres@|:password@|:123456@/.test(databaseUrl)) {
    if (isProd && process.env.ALLOW_INSECURE !== "1") {
      issues.push("生产 DATABASE_URL 疑似弱默认口令——请改强口令，或显式 ALLOW_INSECURE=1 越过");
    } else if (!isProd) {
      console.warn("[config] 开发环境使用弱默认数据库口令（仅提示）");
    }
  }
  // 后门治理（FR-C2.1 / T1）：AUTH_DISABLED 仅限非生产运行时；APP_ENV=production 且非空即拒绝启动
  if (isProd && process.env.AUTH_DISABLED && process.env.AUTH_DISABLED !== "0") {
    issues.push("生产环境禁止 AUTH_DISABLED（万能后门）——请从环境移除后启动");
  }

  const hasGlmKey = Boolean(process.env.ZHIPUAI_API_KEY);
  if (!hasGlmKey && isProd) {
    // AI 是核心链路：生产缺 key 允许启动（health 会降级上报），但给显著告警
    console.warn("[config] 生产环境未配置 ZHIPUAI_API_KEY，AI 能力将不可用（health 降级）");
  }
  if (issues.length > 0) throw new ConfigValidationError(issues);

  cached = {
    env,
    isProd,
    databaseUrl,
    uploadDir: process.env.UPLOAD_DIR ?? null,
    glmModel: process.env.GLM_MODEL ?? GLM_DEFAULT_MODEL,
    glmBaseUrl: process.env.ZHIPUAI_BASE_URL ?? GLM_DEFAULT_BASE_URL,
    jevModel: process.env.JEV_MODEL ?? "jev-latest",
    jevMode: (["off", "shadow", "on"] as const).includes(process.env.JEV_MODE as never)
      ? (process.env.JEV_MODE as "off" | "shadow" | "on")
      : "off",
    hasGlmKey,
    hasJevKey: Boolean(process.env.TYPESAFE_API_KEY),
    get authDisabled() {
      return process.env.AUTH_DISABLED === "1";
    },
    get setupToken() {
      return process.env.SETUP_TOKEN || null;
    },
    get secureCookie() {
      return env === "production";
    },
    get smtp(): SmtpConfig | null {
      const { EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM } = process.env;
      return EMAIL_SMTP_HOST && EMAIL_SMTP_PORT && EMAIL_SMTP_USER && EMAIL_SMTP_PASS && EMAIL_FROM
        ? { host: EMAIL_SMTP_HOST, port: Number(EMAIL_SMTP_PORT), user: EMAIL_SMTP_USER, pass: EMAIL_SMTP_PASS, from: EMAIL_FROM }
        : null;
    },
    get sms(): SmsConfig | null {
      const { TENCENT_SMS_SECRET_ID, TENCENT_SMS_SECRET_KEY, TENCENT_SMS_SDK_APP_ID, TENCENT_SMS_SIGN, TENCENT_SMS_TEMPLATE_ID } = process.env;
      return TENCENT_SMS_SECRET_ID && TENCENT_SMS_SECRET_KEY && TENCENT_SMS_SDK_APP_ID && TENCENT_SMS_SIGN && TENCENT_SMS_TEMPLATE_ID
        ? { secretId: TENCENT_SMS_SECRET_ID, secretKey: TENCENT_SMS_SECRET_KEY, sdkAppId: TENCENT_SMS_SDK_APP_ID, sign: TENCENT_SMS_SIGN, templateId: TENCENT_SMS_TEMPLATE_ID }
        : null;
    },
  };
  return cached;
}

/** 启动期校验入口（instrumentation.register 调用）；成功输出结构化启动日志 */
export function initConfig(): AppConfig {
  const c = loadConfig();
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      level: "info",
      msg: "config-ok",
      env: c.env,
      glmModel: c.glmModel,
      aiKey: c.hasGlmKey,
      jevKey: c.hasJevKey,
    }),
  );
  return c;
}
