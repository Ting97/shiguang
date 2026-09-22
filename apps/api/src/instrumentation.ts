/**
 * Next.js instrumentation：
 * - 启动期 config fail-fast 校验（REQ-004 FR-A2）
 * - 未捕获错误统一落结构化日志（stderr → journald），带请求 id 与完整堆栈
 */
import type { Instrumentation } from "next";
import { initConfig } from "./server/platform/config";
import { log } from "./server/platform/http/logger";
import { startAnalysisPatrol } from "./server/timeline/patrol";

export async function register() {
  // Next 会在构建期也加载 instrumentation：仅运行时执行校验（构建环境缺 env 是正常的）
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      initConfig();
      startAnalysisPatrol(); // FR-C2.4：识别任务巡检补跑（5 分钟周期）
    } catch (e) {
      console.error(String(e instanceof Error ? e.message : e));
      // fail-fast：配置不合法拒绝启动（standalone 下直接退出进程）
      process.exit(1);
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  log.error(
    {
      method: request.method,
      path: request.path,
      stack: err instanceof Error ? err.stack : String(err),
    },
    "unhandled-api-error",
  );
};
