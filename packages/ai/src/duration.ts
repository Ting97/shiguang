/**
 * 中文时长解析 —— 从口语中提取显式时长（分钟）
 * 支持：40分钟 / 一个半小时 / 俩小时 / 两小时 / 半小时 / 三小时 / 50min
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数字（≤9999）转阿拉伯数字：五十四→54，三千五→3500（口语「X千Y」Y 按百位并入），一千零五十→1050
 * （十五轮收口：补「千」，含「零」断链的金额此前整笔返回 null 被静默丢弃），一百二→120（口语省「十」
 * 按整十补齐），十→10（供时长/钟点共用） */
export function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^[零一二两俩三四五六七八九十百千]+$/.test(s)) return null;
  let total = 0;
  let current = 0;
  // 进位后裸数字的位权：口语省「十」（一百二=120、三千五=3500 而非 3050）——百后按十位、千后按百位；
  // 「一千零五十」（零复位）与「三百二十」（有十）走常规位值
  let carryMul = 0;
  const noShi = !s.includes("十");
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
      carryMul = 0;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
      carryMul = 10;
    } else if (ch === "千") {
      total += (current || 1) * 1000;
      current = 0;
      carryMul = 100;
    } else {
      const v = CN_DIGITS[ch];
      if (v === undefined) return null;
      // 口语缩写位权只认末位裸数字（三百五=350、三千五=3500）：中间数字走常规位值，
      // 否则「三千五百」的 五 被抬成 500 再被 百 乘 100 → 53000（十五轮实测踩中）
      const isLast = i === chars.length - 1;
      if (carryMul > 0 && v > 0 && noShi && isLast) {
        current = v * carryMul;
      } else {
        current = current * 10 + v;
      }
      carryMul = 0;
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
  const matches = [...norm.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    // 钟点上下文的 "X点Y分"（如 "下午3点50分开会"）不是时长：前一字符为 点/时 且单位为分 → 跳过。
    // 「时」须回看前一字：N时50分 是钟点，1小时30分 的「时」属于「小时」复合时长
    if (/分|min/.test(m[4]) && m.index > 0) {
      const prev = norm[m.index - 1];
      if (prev === "点" || (prev === "时" && norm[m.index - 2] !== "小")) continue;
    }
    // 约数并列（"两三个小时""三四小时"）先于 cnToNumber：cnToNumber 按复合进位把「两三」直读成 23
    // 小时（1380 分钟垃圾块）——取末位（区间上界），与 parseClock/relativeOffsetDays/parseAmountCents 同款
    const approx = /^([一两俩二三四五六七八九])([一两俩二三四五六七八九])$/.exec(m[1]);
    const n = /^\d+(?:\.\d+)?$/.test(m[1])
      ? parseFloat(m[1])
      : cnToNumber(approx && approx[1] !== approx[2] ? approx[2] : m[1]);
    if (n === null || n === 0) continue;
    const isHour = /小时|钟头|^h$/.test(m[4]);
    // "一个半小时" 与 "一小时半/两小时半" 两形态都补 30；"X分半"忽略。
    // 「小时半」必须紧邻当前匹配（旧版全文扫描：句中任何位置出现「小时半」都会给第一个命中时长 +30，
    // 实测「开会3小时然后骑一小时半」得 210 而非 180）；(?!马)：「两小时半马」是半程马拉松
    const after = norm.slice(m.index + m[0].length);
    const half = m[3] === "半" && isHour ? 30 : isHour && /^\s*半(?!马)/.test(after) ? 30 : 0;
    // 向上保底 1 分钟：「刷了0.4分钟」取整为 0 会撞 ParseResult durationMin>0 契约，
    // 且 rules 兜底路径无 LLM 路径的 max(1) 钳制 → zod 异常逃逸 parseInput（打卡入口不可失败的底线）
    const minutes = Math.max(1, isHour ? Math.round(n * 60) : Math.round(n)); // 小时允许小数 → 分钟取整
    // 复合时长「X小时Y分」：紧邻（间隔≤1字）的小时段+分段累加——旧实现首段即 return，1小时30分→60 少算 30 分
    if (isHour) {
      const nxt = matches[i + 1];
      const gap = nxt && nxt.index !== undefined && m.index !== undefined ? nxt.index - (m.index + m[0].length) : 99;
      if (nxt && gap <= 1 && /分|min/.test(nxt[4])) {
        const prevNxt = nxt.index ? norm[nxt.index - 1] : "";
        const clockCtx = prevNxt === "点" || (prevNxt === "时" && norm[nxt.index - 2] !== "小");
        if (!clockCtx) {
          const n2 = /^\d+(?:\.\d+)?$/.test(nxt[1]) ? parseFloat(nxt[1]) : cnToNumber(nxt[1]);
          if (n2 !== null && n2 > 0) return minutes + half + Math.round(n2);
        }
      }
    }
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

/** 解析金额（元）。返回分；无金额返回 null。例：260→26000、600块→60000、"花了260"→26000、
 *  「花了两万」→2000000、「随了三千五」→350000（十四轮收口：中文数字接入，原版静默丢金额） */
export function parseAmountCents(text: string): number | null {
  const toCents = (s: string) => Math.round(parseFloat(s) * 100);
  // 数字组：阿拉伯（可小数）或中文数字（cnToNumber 换算，≤9999——量词 万 在组外；千 十五轮入组，
  // 让「两千零五」类含零断链数字整体进 cnToNumber 换算，旧版「两千」被量词组消费、「两千零五」整笔 null）
  const NUM = "(?:\\d+(?:\\.\\d{1,2})?|[零一二两俩三四五六七八九十百千]+)";
  // 数字换算：阿拉伯 parseFloat；中文 cnToNumber。约数并列（两三/三四/七八）取末位保守上界
  // （与 relativeOffsetDays 同口径——cnToNumber 按复合进位会误读成 23/34/78）
  const numOf = (s: string): number | null => {
    if (/^\d/.test(s)) return parseFloat(s);
    const approx = s.match(/^([一两俩二三四五六七八九])([一两俩二三四五六七八九])$/);
    return cnToNumber(approx ? approx[2] : s);
  };
  // 尾数位换算：「9块9」「三千五」的尾段——阿拉伯 parseInt，中文单字查表
  const tailNum = (s: string): number | null =>
    /^\d+$/.test(s) ? parseInt(s, 10) : /^[一两二三四五六七八九]$/.test(s) ? (CN_DIGITS[s] ?? null) : null;
  // 千分位先归一："花了1,000元" 旧版会匹配 "000元" → 0 分；无单位分支会只取到 "1" → 1 元。
  // NFKC 顺带把全角 ￥／２６０ 归一为半角
  const norm = text.normalize("NFKC").replace(/[,，]/g, "");
  const CAP = 100_000_000; // amount_cents 为 int4：与 AI 契约同上限（¥100 万），巨数直落会 22003
  // 1) 带单位：260元 / 600块 / ¥99.9 / 1万元 / 2千块 / 两万元（¥ 前缀形态：金额跟在符号后，旧版只认后缀单位漏掉它）
  //    万/千量词：旧版 lookahead 类不含万千，"1万元" 回溯成裸 "1元"（静默缩小 1 万倍）
  //    lookbehind 防抢跑："1万2千元" 不得从中间的 "2千元" 起配（前面是量词=大数未完，交给 noUnit 整体解析）
  const withUnit = norm.match(new RegExp(`(?<![0-9.万千百零一二两俩三四五六七八九十])(${NUM})\\s*(万|千)?\\s*(块|元|¥)`));
  if (withUnit) {
    const n = numOf(withUnit[1]);
    if (n === null) return null; // 中文数字换算失败：宁 null 勿错
    const mult = withUnit[2] === "万" ? 10_000 : withUnit[2] === "千" ? 1_000 : 1;
    // 口语尾数守卫：「9块9」「35块5」「三块五」（十五轮：中文尾字并入，旧版「一块五」少算 5 毛）
    // = 9.9/35.5/1.5 元。尾数只认单位后紧跟的 1~2 位数字或单个中文数字（「9块9角」同型并入=990 分，
    // 角/毛即 0.1 元）；3 位以上是另一段数字（「12元5000」类量词/编号）不并，宁少勿错；
    // 后跟量词字同样不并（十六轮：「买了100元5张票」的 5 是数量，旧版并入成 100.5 元——
    // 张/条/个/件/只/支/页/位/名/枚/封/次 起头的数量短语不是口语毛数）
    const end = (withUnit.index ?? 0) + withUnit[0].length;
    const tail = /^(\d{1,2}|[一两二三四五六七八九])(?!\d)(?![张条个件只支页位名枚封次瓶杯盒包箱度克斤米岁层栋间节场班趟幅首部台套把辆轮])/.exec(
      norm.slice(end),
    );
    const tailV = tail
      ? (/^\d/.test(tail[1]) ? parseInt(tail[1], 10) : (CN_DIGITS[tail[1]] ?? 0)) / 10 ** tail[1].length
      : 0;
    const cents = Math.round((n * mult + tailV) * 100);
    return cents > CAP ? CAP : cents;
  }
  const prefixed = norm.match(/¥\s*(\d+(?:\.\d{1,2})?)/);
  if (prefixed) {
    const cents = toCents(prefixed[1]);
    return cents > CAP ? CAP : cents;
  }
  // 2) 动词暗示（无单位）："花了260""随了600""付了86""花了两万""随了三千五"；
  //    收入侧（十五轮补）：到账/进账/报销/入账/收到/发——旧版动词表全是支出，规则兜底路径
  //    「到账500」「报销了300」静默丢金额；方向判定在 ruleExtract（发红包→out、收到/工资→in）不在此层。
  //    负向断言排除时长/日期词（"花了50分钟""花了3小时""花了2周"都不是钱——"小""周"必须入排除类；
  //    "万千百"也必须入——它们由量词组消费，留在原文意味着量词组匹配失败，整体应放弃而非缩水成裸数字；
  //    kK/wW 同理入排除类（十五轮 P1 收口口径：带 kK/wW 后缀的「花了1.5k/2w」整体放弃返回 null，
  //    宁 null 勿错——旧版会缩水成 1.5 元/2 元；正解走带单位分支或模型识别）；
  //    条/枚/封/张/个/件/位/名 为非货币量词——"发了2条消息""收到3个包裹"不得记成 2/3 元）
  //    万/千量词："花了1万"=100万分（旧实现漏乘，静默缩小 100/10 倍）；
  //    口语尾数按位下降链："花了1万2"=1.2万、"1万2千"=12000、"1万2千5"=12500、"2千5"=2500、
  //    "1万2千5百"=12500、"两万五"=25000、"三千五百"=3500——两级尾数组缺一会让整场匹配失败返回 null，该笔花销静默消失（历史 bug）
  const noUnit = norm.match(
    new RegExp(
      `(?:花费|消费|花|随|付|充值|打款|到账|进账|报销|入账|收到|(?<!出)发)(?:了)?\\s*(${NUM})\\s*(万|千)?\\s*(?:(\\d{1,2}|[一两二三四五六七八九])(千|百)?)?\\s*(?:(\\d{1,2}|[一两二三四五六七八九])(百)?)?(?![\\d.天日个月年时分秒小周万千百kKwW零一二两俩三四五六七八九十条枚封张个件位名])`,
    ),
  );
  if (noUnit) {
    const head = numOf(noUnit[1]);
    if (head === null) return null;
    const mult = noUnit[2] === "万" ? 10_000 : noUnit[2] === "千" ? 1_000 : 1;
    let value = head * (noUnit[2] ? mult : 1);
    let place = noUnit[2] ? mult / 10 : 0; // 下一段裸尾数的默认位值（万→千、千→百、百→十）
    for (const g of [3, 5] as const) {
      const digits = noUnit[g];
      if (!digits) break; // 位值链断裂（lookahead 已保证不会发生，防御性终止）
      const unit = noUnit[g + 1];
      const p = unit === "千" ? 1_000 : unit === "百" ? 100 : place;
      const d = tailNum(digits);
      if (d === null) return null; // 尾段换算失败：宁 null 勿错
      value += d * p;
      place = p / 10;
    }
    const cents = Math.round(value * 100);
    return cents > CAP ? CAP : cents;
  }
  return null;
}
