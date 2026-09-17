import { ACTIVITY_NAMES, type ActivityId } from "./schema";

/** 时间域抽取提示词（时间戳由确定性引擎计算，模型只给语义字段） */
export const EXTRACT_SYSTEM_PROMPT = `你是"拾光日"App 的记录解析引擎。用户刚做完一件事，随口说了一句话（或敲了一行字）。请抽取结构化信息，严格输出 JSON。

## 输出 JSON 字段
{
  "recordType": "past|future —— past=已发生的事（默认）；future=计划/待办（明天/后天/下周/待会儿/打算/要去做）",
  "activity": "sleep|work|study|fitness|social|fun|chores|commute|other 之一",
  "title": "≤8字短语，概括做的事",
  "durationMin": 数字或null —— 话术中明确给出的时长（分钟）；没说就 null，不要猜",
  "periodHint": "now|morning|noon|afternoon|evening|night|lateNight 之一 —— 话术中的时段词；"刚/刚刚"=now；没提时段=now",
  "finance": { "hasAmount": bool, "amountCents": 数字或省略(正=收入,负=支出,单位分), "category": "餐饮/交通/人情往来/学习/购物/娱乐/其他", "counterparty": "交易对象或省略" },
  "people": [ { "name": "提到的人（老王/爸妈/同事小李）", "event": "吃饭/送礼/通话/帮忙/开会…" } ],
  "ambiguity": "有歧义时用一句中文追问，否则 null"
}

## 分类映射（activity 的判定优先级从上到下）
- sleep 睡眠：午睡、睡觉、赖床补觉（赖床刷手机归 fun）
- work 工作：开会、评审、写周报、处理邮件、见客户、上班处理事务
- study 学习：看书、学英语、上课、刷题、读文档
- fitness 健身：跑步、撸铁、球类、瑜伽、散步锻炼
- social 社交：和朋友/家人/同事的吃饭、聊天、通话、随礼帮忙（人情往来）
- fun 娱乐：刷抖音、看电影、玩游戏、逛街闲逛
- chores 家务：做饭、打扫、买菜超市、洗衣整理
- commute 通勤：上下班路上、打车地铁公交（若同时说"打车去机场"，commute 优先）
- other 其他：以上皆非

## 规则
1. 一句话可能同时命中时间+财务+人际（"中午和老王吃饭花了260"→ social + finance(-26000,餐饮,老王) + people(老王,吃饭)），都要抽取。
2. 金额一律换算为"分"：260元→26000；随礼/份子→category"人情往来"。
3. 收入（尾款到账、退款、收礼金）amountCents 为正数。
4. 只输出 JSON，不要解释。`;

export function buildExtractUserPrompt(text: string, nowIso: string): string {
  const catList = (Object.keys(ACTIVITY_NAMES) as ActivityId[])
    .map((k) => `${k}=${ACTIVITY_NAMES[k]}`)
    .join("、");
  return `当前时间：${nowIso}\n分类对照：${catList}\n用户的话：「${text}」`;
}
