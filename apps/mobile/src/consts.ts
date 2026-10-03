/**
 * 语音输入常量（REQ-009 9-D 拆分自 App.tsx）：长按起录 / 自动停 / 取消手势阈值。
 */

/** 长按起录的等待时长：松开早于它 = 点按打开文字面板 */
export const LONG_PRESS_MS = 500;
/** 语音最长 30 秒（GLM-ASR 单文件限制 0–30s），29 秒自动停止留余量 */
export const VOICE_MAX_SECONDS = 30;
export const AUTO_STOP_MS = (VOICE_MAX_SECONDS - 1) * 1000;
/** 短于此时长视为误触，不送识别 */
export const MIN_HOLD_MS = 600;
/** 按住时上滑超过该逻辑像素视为「取消」手势 */
export const CANCEL_SLIDE_PX = 80;
/** 动态流每页条数（loadFeed offset 翻页，REQ-009 9-D 无限翻页） */
export const FEED_PAGE_SIZE = 20;
/** 交易每日盈亏窗口：初始 30 日，触底每次外扩 30 日，上限 90 日 */
export const TRADES_RANGE_INIT = 30;
export const TRADES_RANGE_STEP = 30;
export const TRADES_RANGE_MAX = 90;
