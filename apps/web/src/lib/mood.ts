/** 心情展示：词 → emoji / 情绪色调（未收录的词兜底 ✨） */
const MOOD_EMOJI: Array<[RegExp, string]> = [
  [/生气|气死|愤怒|火大|气人/, "😠"],
  [/难过|伤心|失落|想哭|emo|崩溃/, "😢"],
  [/委屈|心酸/, "🥺"],
  [/孤独|寂寞/, "😔"],
  [/焦虑|压力|紧张|担心|慌|发愁/, "😟"],
  [/烦|暴躁|郁闷|抓狂|无语|无聊/, "😤"],
  [/累|疲惫|困|犯困|乏力|虚/, "😪"],
  [/幸福|感恩|感谢|幸运/, "🥰"],
  [/兴奋|激动|期待|迫不及待/, "🤩"],
  [/开心|高兴|快乐|心情好|心情不错|爽|美滋滋/, "😊"],
  [/满足|充实|值得|值了|成就|骄傲/, "😌"],
  [/放松|舒服|惬意|治愈|解压|舒坦/, "😌"],
  [/平静|还行|一般|淡淡/, "🙂"],
];

export function moodEmoji(label: string | null | undefined): string {
  if (!label) return "📝";
  return MOOD_EMOJI.find(([re]) => re.test(label))?.[1] ?? "✨";
}

/** 情绪分 → 颜色（积极=琥珀暖色 / 消极=玫瑰 / 无=石墨） */
export function moodTone(score: number | null | undefined): string {
  if (score == null) return "text-ink-mute";
  if (score > 0) return "text-warn";
  if (score < 0) return "text-danger";
  return "text-ink-soft";
}
