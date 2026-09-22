/**
 * Next.js instrumentation：
 * - 启动期 config fail-fast 校验（REQ-004 FR-A2）
 * - 未捕获错误统一落结构化日志（stderr → journald），带请求 id 与完整堆栈
 */
import type { Instrumentation } from "next";
import { initConfig } from "./server/platform/config";
import { log } from "./server/platform/http/logger";

export async function register() {
  // Next 会在构建期也加载 instrumentation：仅运行时执行校验（构建环境缺 env 是正常的）
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      initConfig();
      // FR-C2.4：识别任务巡检补跑（5 分钟周期）。instrumentation 会被 Edge runtime 一并编译，
      // pg 图谱必须锁在 nodejs 分支内（NEXT_RUNTIME 为编译期常量，edge 构建整支剪除）
      if (process.env.NEXT_RUNTIME === "nodejs") {
        const { startAnalysisPatrol } = await import("./server/timeline/patrol");
        startAnalysisPatrol();
      }
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
