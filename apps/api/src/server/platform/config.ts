/**
 * 平台基建：env 集中读取与启动校验（REQ-004 FR-A2.1/A2.2）。
 * - 全仓禁止散读 process.env（ESLint no-restricted-imports/圈禁约定），统一经此模块
 * - initConfig() 在 instrumentation 启动时调用一次：fail-fast——缺失必需项列清单退出；
 *   生产环境 AUTH_DISABLED 非空即拒绝启动、弱默认连接串须显式 ALLOW_INSECURE=1 越过
 */

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
    glmModel: process.env.GLM_MODEL ?? "glm-5.3-flash",
    glmBaseUrl: process.env.ZHIPUAI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    jevModel: process.env.JEV_MODEL ?? "jev-latest",
    jevMode: (["off", "shadow", "on"] as const).includes(process.env.JEV_MODE as never)
      ? (process.env.JEV_MODE as "off" | "shadow" | "on")
      : "off",
    hasGlmKey,
    hasJevKey: Boolean(process.env.TYPESAFE_API_KEY),
  };
  if (isProd && process.env.AUTH_DISABLED && process.env.AUTH_DISABLED !== "0") {
    // 不可达（上方已 throw）；双保险防御
    throw new ConfigValidationError(["生产环境禁止 AUTH_DISABLED"]);
  }
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
