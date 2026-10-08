/**
 * 中文时长解析 —— 从口语中提取显式时长（分钟）
 * 支持：40分钟 / 一个半小时 / 俩小时 / 两小时 / 半小时 / 三小时 / 50min
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数字（≤999）转阿拉伯数字：五十四→54，一百二→120（口语省「十」按整十补齐），十→10（供时长/钟点共用） */
export function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^[零一二两俩三四五六七八九十百]+$/.test(s)) return null;
  let total = 0;
  let current = 0;
  // 口语省「十」（一百二=120 而非 102）：百后紧跟 1~9 且全句无「十」时按整十补齐；
  // 「一百二十」（有十）与「一百零二」（零复位）走常规路径
  let afterBai = false;
  const noShi = !s.includes("十");
  for (const ch of s) {
    if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
      afterBai = false;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
      afterBai = true;
    } else {
      const v = CN_DIGITS[ch];
      if (v === undefined) return null;
      if (afterBai && v > 0 && noShi) {
        current = v * 10;
      } else {
        current = current * 10 + v;
      }
      afterBai = false;
    }
  }
  return total + current;
}

/**
 * 解析文本中出现的时长。返回分钟数；未发现返回 null。
 * 例：一个半小时→90、俩小时→120、半小时→30、40分钟→40、三小时→180
 */
export function parseDuration(text: string): number | null {
  // 全角数字/符号（２６０、３小时）先归一为半角，避免全线落空
  const norm = text.normalize("NFKC");
  // 1) 数字 + (个半)? + 单位（先跑通用式，"一个半小时"在此命中 90）；小数支持 "1.5小时"
  //    显式数字时长优先于惯用语——「周一下午开了3小时会」应得 120 而非 240
  const re =
    /(\d+(?:\.\d+)?|[零一二两俩三四五六七八九十百]+)\s*(个)?\s*(半)?\s*(个小时|小时|钟头|h|分钟|分|min)/g;
  for (const m of norm.matchAll(re)) {
    // 钟点上下文的 "X点Y分"（如 "下午3点50分开会"）不是时长：前一字符为 点/时 且单位为分 → 跳过
    if (/分|min/.test(m[4]) && m.index > 0 && /[点时]/.test(norm[m.index - 1])) continue;
    const n = /^\d+(?:\.\d+)?$/.test(m[1]) ? parseFloat(m[1]) : cnToNumber(m[1]);
    if (n === null || n === 0) continue;
    const isHour = /小时|钟头|^h$/.test(m[4]);
    const half = m[3] === "半" && isHour ? 30 : 0; // "一个半小时"；"X分半"忽略
    // 向上保底 1 分钟：「刷了0.4分钟」取整为 0 会撞 ParseResult durationMin>0 契约，
    // 且 rules 兜底路径无 LLM 路径的 max(1) 钳制 → zod 异常逃逸 parseInput（打卡入口不可失败的底线）
    const minutes = Math.max(1, isHour ? Math.round(n * 60) : Math.round(n)); // 小时允许小数 → 分钟取整
    return minutes + half;
  }

  // 2) 裸 "半小时" / "半个钟头"（上面未命中时）
  if (/半(个)?(小时|钟头)/.test(norm)) return 30;

  // 3) 惯用语：显式时长未命中时兜底；lookbehind 排除「周一下午/礼拜天半天」等星期限定误命中
  if (/(?<!周天|礼拜天|星期天|周|礼拜|星期|这|那|某|同)(一上午|一下午|半天)/.test(norm)) return 240;
  if (/一整天|全天/.test(norm)) return 480;
  if (/吃食堂|食堂饭|便饭/.test(norm)) return 40;

  // 4) 纯 "X 到 Y 点" 类区间不在此处理（时间推断层负责）
  return null;
}

/** 解析金额（元）。返回分；无金额返回 null。例：260→26000、600块→60000、"花了260"→26000 */
export function parseAmountCents(text: string): number | null {
  const toCents = (s: string) => Math.round(parseFloat(s) * 100);
  // 千分位先归一："花了1,000元" 旧版会匹配 "000元" → 0 分；无单位分支会只取到 "1" → 1 元。
  // NFKC 顺带把全角 ￥／２６０ 归一为半角
  const norm = text.normalize("NFKC").replace(/[,，]/g, "");
  const CAP = 100_000_000; // amount_cents 为 int4：与 AI 契约同上限（¥100 万），巨数直落会 22003
  // 1) 带单位：260元 / 600块 / ¥99.9 / ¥99.9（¥ 前缀形态：金额跟在符号后，旧版只认后缀单位漏掉它）
  const withUnit = norm.match(/(\d+(?:\.\d{1,2})?)\s*(块|元|¥)/);
  if (withUnit) {
    const cents = toCents(withUnit[1]);
    return cents > CAP ? CAP : cents;
  }
  const prefixed = norm.match(/¥\s*(\d+(?:\.\d{1,2})?)/);
  if (prefixed) {
    const cents = toCents(prefixed[1]);
    return cents > CAP ? CAP : cents;
  }
  // 2) 动词暗示（无单位）："花了260""随了600""付了86"；负向断言排除时长/日期词
  //    （"花了50分钟""花了3小时""花了2周"都不是钱——"小""周"必须入排除类）
  //    万/千量词："花了1万"=100万分（旧实现漏乘，静默缩小 100/10 倍）；
  //    口语尾数："花了1万2"=12000分→120万分（旧版断言失败回溯成 "1" 元，静默缩小 120 倍）
  const noUnit = norm.match(
    /(?:花费|消费|花|随|付|充值|打款)(?:了)?\s*(\d+(?:\.\d{1,2})?)\s*(万|千)?(\d{1,2})?(?![\d.天日个月年时分秒块元小周])/,
  );
  if (noUnit) {
    const mult = noUnit[2] === "万" ? 10_000 : noUnit[2] === "千" ? 1_000 : 1;
    const tail = noUnit[3] ? parseInt(noUnit[3], 10) : 0; // 「1万2」的尾数按 mult/10 位补足
    const value = noUnit[2] ? parseFloat(noUnit[1]) * mult + tail * (mult / 10) : parseFloat(noUnit[1]);
    const cents = Math.round(value * 100);
    return cents > CAP ? CAP : cents;
  }
  return null;
}
