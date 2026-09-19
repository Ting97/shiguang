/**
 * solarlunar 类型声明（包内 .d.ts 未在 package.json exports 中暴露，tsc 无法解析）
 * 只声明本项目用到的子集：公历↔农历互转 + 中文月/日标签
 */
declare module "solarlunar" {
  export interface SolarLunarResult {
    lYear: number;
    lMonth: number;
    lDay: number;
    monthCn: string;
    dayCn: string;
    cYear: number;
    cMonth: number;
    cDay: number;
    isLeap: boolean;
  }
  const solarLunar: {
    toChinaMonth(m: number): string;
    toChinaDay(d: number): string;
    lunar2solar(year: number, month: number, day: number, isLeapMonth?: boolean): SolarLunarResult | -1;
    solar2lunar(year?: number, month?: number, day?: number): SolarLunarResult | -1;
  };
  export default solarLunar;
}
