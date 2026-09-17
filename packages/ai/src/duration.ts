/**
 * 中文时长解析 —— 从口语中提取显式时长（分钟）
 * 支持：40分钟 / 一个半小时 / 俩小时 / 两小时 / 半小时 / 三小时 / 50min
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数字（≤999）转阿拉伯数字：五十四→54，一百二→120，十→10（供时长/钟点共用） */
export function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^[零一二两俩三四五六七八九十百]+$/.test(s)) return null;
  let total = 0;
  let current = 0;
  for (const ch of s) {
    const v = CN_DIGITS[ch];
    if (v === undefined) return null;
    if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else {
      current = current * 10 + v;
    }
  }
  return total + current;
}

/**
 * 解析文本中出现的时长。返回分钟数；未发现返回 null。
 * 例：一个半小时→90、俩小时→120、半小时→30、40分钟→40、三小时→180
 */
export function parseDuration(text: string): number | null {
  // 0) 惯用语（先于一切规则）
  if (/一上午|一下午|半天/.test(text)) return 240;
  if (/一整天|全天/.test(text)) return 480;
  if (/吃食堂|食堂饭|便饭/.test(text)) return 40;

  // 1) 数字 + (个半)? + 单位（先跑通用式，"一个半小时"在此命中 90）
  const re =
    /(\d+|[零一二两俩三四五六七八九十百]+)\s*(个)?\s*(半)?\s*(个小时|小时|钟头|h|分钟|分|min)/g;
  for (const m of text.matchAll(re)) {
    const n = cnToNumber(m[1]);
    if (n === null || n === 0) continue;
    const isHour = /小时|钟头|^h$/.test(m[4]);
    const half = m[3] === "半" && isHour ? 30 : 0; // "一个半小时"；"X分半"忽略
    const minutes = isHour ? n * 60 : n;
    return minutes + half;
  }

  // 2) 裸 "半小时" / "半个钟头"（上面未命中时）
  if (/半(个)?(小时|钟头)/.test(text)) return 30;

  // 3) 纯 "X 到 Y 点" 类区间不在此处理（时间推断层负责）
  return null;
}

/** 解析金额（元）。返回分；无金额返回 null。例：260→26000、600块→60000、"花了260"→26000 */
export function parseAmountCents(text: string): number | null {
  const toCents = (s: string) => Math.round(parseFloat(s) * 100);
  // 1) 带单位：260元 / 600块 / ¥99.9
  const withUnit = text.match(/(\d+(?:\.\d{1,2})?)\s*(块|元|¥)/);
  if (withUnit) return toCents(withUnit[1]);
  // 2) 动词暗示（无单位）："花了260""随了600""付了86"；排除"花了50分钟"（防回溯截断）
  const noUnit = text.match(
    /(?:花费|消费|花|随|付|充值|打款)(?:了)?\s*(\d+(?:\.\d{1,2})?)(?![\d.天日个月年时分秒块元])/,
  );
  if (noUnit) return toCents(noUnit[1]);
  return null;
}
