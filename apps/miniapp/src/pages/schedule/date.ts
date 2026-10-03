/**
 * 日程页日期/时间工具门面（REQ-009 9-C 单源化）。
 * 本文件原是 web lib/date + lib/bj-time 的整份手工拷贝；现全部函数已在 @shiguangri/shared 单源
 * （含北京时区日历日与北京墙上时间两组），这里 re-export 维持日程页各文件与
 * packages/calendar 的既有引入（"./date" / "@/pages/schedule/date"）不散改。
 * 口径不变：全部走北京时区（UTC+8）——本地 getter 在海外设备会把日界/时刻错 8 小时。
 */
export {
  pad,
  ymd,
  todayStr,
  localDateKey,
  parseYmd,
  addDays,
  startOfWeek,
  startOfMonth,
  startOfYear,
  weekName,
  zhDate,
  zhDuration,
  bjToday,
  bjAddDays,
  bjMondayOf,
  bjDayIdx,
  bjDateKey,
  bjNowMin,
  zhTime,
  combineHM,
  isoToBjInput,
  bjInputToIso,
} from "@shiguangri/shared";
