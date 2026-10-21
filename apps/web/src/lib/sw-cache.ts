/**
 * 登出时清理 SW 的 /api/* 数据缓存（十一轮隐私修复）。
 * sw.js 会把全部 /api/* GET 200 JSON 写入 Cache Storage（离线兜底），其中含
 * /api/feed、/api/contacts、/api/finance/* 等带鉴权的个人数据；登出若不清，
 * 共用设备上任何人可经 DevTools/离线回放读到上一账号的数据。
 * 通道：postMessage 通知 SW 自删缓存（页面侧无权异步等待完成，尽力而为 +
 * SW 侧 activate 时的版本清理兜底）；无 SW 控制时静默跳过。
 */
export function clearCachedApiData(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_USER_CACHE" });
  } catch {
    // 无 SW / 非安全上下文等：登出主流程不受影响
  }
}
