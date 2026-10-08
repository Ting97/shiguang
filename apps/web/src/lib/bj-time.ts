/** 北京时间（UTC+8）展示/存储小工具 —— 实现单源自 @shiguangri/shared/date（REQ-009 9-C 收敛）：
 * 本文件此前是分叉副本，combineHM 缺非法输入守卫（清空时间输入保存会 Invalid time value 抛错），
 * shared 版已有守卫与测试（date-bj.test.ts），这里纯转发防再分叉 */

export { zhTime, combineHM, isoToBjInput, bjInputToIso, bjDateKey } from "@shiguangri/shared";
