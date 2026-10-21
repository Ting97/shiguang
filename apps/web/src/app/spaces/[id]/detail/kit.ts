/** 空间详情页小工具（自 detail.tsx 拆出） */

// 北京日历日工具收敛到 @shiguangri/shared 单源（030/032 轮已归拢五处，此处是残留副本）：
// bjDate（pg date 序列化 UTC ISO → 北京日期 YYYY-MM-DD）与 shared bjDateKey 同义；
//bjToday 同 shared。改名转发保持 detail 页内既有调用点不变。
export { bjDateKey as bjDate, bjToday } from "@shiguangri/shared";
