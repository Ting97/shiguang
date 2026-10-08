/** 心情规则表：[匹配词, 心情词, 基准情绪分]（规则引擎兜底 & LLM 缺 score 时的补全依据） */
const MOOD_RULES: Array<[RegExp, string, number]> = [
  [/生气|气死|愤怒|火大|气人/, "生气", -80],
  [/难过|伤心|失落|想哭|emo|崩溃/, "难过", -70],
  [/委屈|心酸/, "委屈", -60],
  [/孤独|寂寞/, "孤独", -60],
  [/焦虑|压力|紧张|担心|慌|发愁/, "焦虑", -60],
  [/烦|暴躁|郁闷|抓狂|无语/, "烦躁", -60],
  [/累|疲惫|困|犯困|乏力|虚/, "疲惫", -40],
  [/幸福|感恩|感谢|幸运/, "幸福", 70],
  [/兴奋|激动|期待|迫不及待/, "兴奋", 80],
  [/开心|高兴|快乐|心情好|心情不错|心情真好|状态不错|状态很好|爽|美滋滋/, "开心", 60],
  [/满足|充实|值得|值了|有成就感|骄傲/, "满足", 60],
  [/放松|舒服|惬意|治愈|解压|舒坦/, "放松", 50],
  [/平静|还行|一般|淡淡/, "平静", 10],
];

/** 否定前缀：命中词紧邻的前 1~2 字符含否定词，或「没」后跟 量词副词（没什么/没怎么） → 视为否定
 *  （「不开心」不是「开心」；「没什么难过」「没怎么累」也是否定——旧版只看紧邻一字会漏）。
 *  规则引擎是 GLM 熔断/超时时的唯一兜底，极性反转的误判会以相反情绪分直接入库 */
const NEGATORS = /[不没别]$|没(?=[什么怎这])/;

/** 程度副词白名单：紧邻命中词时是修饰不是否定（「特别」以 别$ 落进 NEGATORS 的 3 字符窗口，误伤「特别累/特别开心」） */
const DEGREE_ADVERBS = /(?:特别|格外|尤其|超|太|好|真|挺)$/;

export function negated(re: RegExp, text: string): boolean {
  for (const m of text.matchAll(new RegExp(re.source, "g"))) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 3), m.index);
    if (DEGREE_ADVERBS.test(before)) return false; // 程度副词修饰 → 本义，非否定
    if (!NEGATORS.test(before)) return false; // 存在未否定的命中 → 该规则成立
  }
  return true; // 所有命中都被否定（或无命中）→ 视为否定/不成立
}

/** 规则引擎心情识别：返回 null=无情绪色彩 */
export function ruleMood(text: string): { label: string; score: number } | null {
  for (const [re, label, score] of MOOD_RULES) {
    if (re.test(text) && !negated(re, text)) return { label, score };
  }
  return null;
}
