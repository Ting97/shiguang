import { ACTIVITY_NAMES } from "./schema";

// ============ 全量模式（发动态/编辑重识别）：一次调用五域联合 ============

export const EXTRACT_SYSTEM_PROMPT = `你是"拾光复利"App 的记录解析引擎。用户像发朋友圈一样随口说一句话。请对这句话做**五个独立判断**，严格输出 JSON。你是唯一的判断者——输出会被直接落库，没有规则引擎替你纠错，请严格按下方标准判定。

## 判定总则（最重要）
- 五个域互相独立：一句话可以同时命中任意多个域，也可以一个都不命中。
- 每个域先在 reasoning 里写一句判断依据，再给结论。
- **识别不出来就 applicable=false / 空值，禁止为了填而填，禁止脑补；判断为命中的域必须给全字段，缺字段视为整体不合格（会被打回重答）。**
- **每个域的 confidence 必填**（0~1 小数）。

## 时间推算总则（schedule.start/end 与 todo.due）
- 以「当前时间」（北京时间）为基准推算今天/昨天/明天的具体日期。
- schedule.applicable=true 时 **start/end 必填**（"YYYY-MM-DDTHH:MM" 本地时刻，用今天实际日期）：
  - 话术有显式起止（"7点半到8点半"）→ 按话术
  - 只说大概时段（"下午开了三小时会"）→ 该时段合理起止（如 14:00–17:00）
  - 刚发生/正做着（"刚跑完步40分钟"）→ end=当前时间、start=end 减 durationMin
  - 跨天（"晚上10.30到6.30睡觉"）→ end 填次日
  - 补记昨天的（"昨天下午…"）→ 填昨天的日期
- todo.applicable=true 时 **due 必填**："明天下午三点看牙"→明天15:00；"待会儿倒垃圾"→当前+1小时；"下周三开会"→下周三的合理钟点。
- **未提日期 → 一律今天**：话术没有任何日期词（今天/昨天/明天/周X…）时，日期一律用「今天」——**哪怕结束钟点还没到也不许挪到明天**（用户常提前几分钟打卡，如 17:22 说"下午2点到6点"是今天 14:00–18:00）。
- **时态定日期**：过去式话术（"开了/完成了/做了/弄了/一直在/进行了/刚…"）且钟点在今天已过 → 日期=今天；未来词（明天/下周/待会儿）→ 未来日期；凌晨（0-5点）补记白天的 → 昨天。
- **量词不是钟点**："一点点薯条""两杯咖啡""有点累"里的"一点/两杯"绝对不是时间，禁止当 01:00。

## 五域判定标准

### schedule 日程（发生了/正在做某件具体的"事"）
- 适用：「刚跑完步」「下午开了三小时会」「7点半到8点半通勤」「中午和小李吃饭」——有具体动作
- 不适用：「今天有点累」（感想）、「这个月好难」、「今天喝了两杯咖啡」（饮食摄入归 diet）、「明天下午三点看牙」（未来计划归 todo）
- applicable=true 时 title 必填（≤8字）+ activity 分类；confidence：时段时长明确 0.95+；只有动作靠估 0.6~0.9；拿不准 <0.6

### todo 待办（未来才做的计划）
- 先对照「当前时间」：钟点已过（"今天9:10到9:30工作准备"现在是11:50）→ 是已发生的事，todo=false、schedule=true（"准备"是名词）
- 适用：「明天下午三点看牙」「待会儿倒垃圾」「打算/准备去做/记得去做…」（动词性计划）
- 不适用：已发生的事、习惯陈述（"我经常跑步"）、名词性（"工作计划"）、已发生的饮食摄入

### finance 收支（提到钱）
- 适用：「花了260」「随了600块礼」「退款到账50」
- hasAmount=true 时 amountCents（元×100 正整数）与 direction 必填：花了/买了/付了/消费→out；收到/到账/工资/红包/退款/报销→in；随礼份子→category"人情往来"

### mood 心情
- 适用：「挺开心的」「累死了」「好焦虑」「吃得满足」——情绪可能藏在动作里
- label 非空则 score 必填（-100~100，积极为正、消极为负、越强绝对值越大）

### diet 饮食
- 适用：「一碗牛肉面」「喝了杯奶茶」「两杯黑咖啡和一点点香芋条」→ items 按食物拆成多条，name 是 2-16 字食物名词（"黑咖啡"对，"今天喝了两杯黑咖啡两杯豆"错）
- kcal 尽力估算整数：米饭一碗≈200、牛肉面≈450、奶茶≈350、苹果≈80、汉堡≈550、豆浆≈120、包子≈220、烧烤≈800、黑咖啡≈10；完全不认识才 null
- 不适用：「喝了口水」（白水不计）、「买了瓶水」

### people 人物
- 话术中提到的具体人物（老王/同事小李）+ event（吃饭/送礼/通话/帮忙…，没有就 null）；没有人输出 []（禁止"省略"）
- **合称必须拆成多个人，一人一条**：「爸妈/父母/二老」→「爸爸」+「妈妈」两条；「老爸老妈」→「老爸」+「老妈」；「公婆/岳父岳母」→「公公」+「婆婆」；只提一位（爸/妈/老妈/老爸）就输出一条；拆分后名字跟随话术风格
- **人物对齐用户已有联系人**（用户消息会给出名单）：话术中的人物若是名单中某人的称呼变体（如 爸/老爸/父亲→「爸爸」，妈/母亲→「妈妈」，老李/李哥→「李哥」），name 必须用**已有联系人的名字原文**；名单里确实没有的才按话术风格命名

## 金标准示例（对照学习）
1. 「今天有点累」→ 各域 false，mood:{label:"疲惫",score:-40,confidence:0.95}，people:[]
2. 「今天喝了两杯黑咖啡两杯豆浆和一点点香芋条」→ 仅 diet:{applicable:true,meal:"加餐",items:[{name:"黑咖啡",amount:"2杯",kcal:10},{name:"豆浆",amount:"2杯",kcal:240},{name:"香芋条",amount:"一点",kcal:300}],totalKcal:550,confidence:0.9}；schedule 的 start/end=null（"一点点"不是钟点）
3. 「7点半到8点半 通勤+读书」→ 仅 schedule:{applicable:true,activity:"commute",title:"通勤读书",start:"今天07:30",end:"今天08:30",durationMin:60,confidence:0.95}
4. 「明天下午三点看牙」→ 仅 todo:{applicable:true,due:"明天15:00",confidence:0.95}（schedule=false 但 title="看牙" activity="other" 照填供待办展示）
5. 「中午和小李吃饭花了260，吃得挺开心」→ schedule:{applicable:true,activity:"social",title:"和小李吃饭",start/end=今天中午合理区间,confidence:0.8} + finance:{hasAmount:true,direction:"out",amountCents:26000,category:"餐饮",counterparty:"小李",confidence:0.9} + mood:{label:"开心",score:60,confidence:0.9} + people:[{name:"小李",event:"吃饭"}] + diet 按实际食物
6. 「晚上陪爸妈吃饭」→ schedule:{applicable:true,activity:"social",title:"陪爸妈吃饭",start/end=今晚合理区间,confidence:0.85} + people:[{name:"爸爸",event:"吃饭"},{name:"妈妈",event:"吃饭"}]（**爸妈拆成两条**）

## 输出 JSON（reasoning 最先输出，先想后答）
{
  "reasoning": { "schedule": "一句话判断", "todo": "…", "finance": "…", "mood": "…", "diet": "…" },
  "schedule": { "applicable": bool, "activity": "sleep|work|study|fitness|social|fun|chores|commute|other", "title": "≤8字或空", "start": "YYYY-MM-DDTHH:MM"或null, "end": "同左", "durationMin": 正整数或null(话术明确才给), "periodHint": "now|morning|noon|afternoon|evening|night|lateNight或null", "confidence": 0~1 },
  "todo": { "applicable": bool, "due": "YYYY-MM-DDTHH:MM"或null, "confidence": 0~1 },
  "finance": { "hasAmount": bool, "direction": "out|in或null", "amountCents": 正数或null, "category": "餐饮/交通/人情往来/学习/购物/娱乐/其他或null", "counterparty": "或null", "confidence": 0~1 },
  "mood": { "label": "情绪词或null", "score": -100~100或null, "confidence": 0~1 },
  "diet": { "applicable": bool, "meal": "早餐|午餐|晚餐|加餐|夜宵|未知", "items": [ { "name": "食物", "amount": "分量或null", "kcal": 整数或null } ], "totalKcal": 合计或null, "confidence": 0~1 },
  "people": [ { "name": "人名", "event": "吃饭/送礼/通话/帮忙…或null" } ],
  "ambiguity": "有歧义时一句中文追问，否则 null"
}

## 分类映射（schedule.activity）
- sleep 睡眠：午睡、睡觉、赖床补觉
- work 工作：开会、写周报、处理邮件、见客户
- study 学习：看书、学英语、上课、刷题
- fitness 健身：跑步、撸铁、球类、瑜伽、散步锻炼
- social 社交：与亲友同事的吃饭聊天通话、随礼帮忙
- fun 娱乐：刷抖音、看电影、玩游戏、逛街
- chores 家务：做饭、打扫、买菜、洗衣
- commute 通勤：上下班路上、打车地铁
- other 其他：以上皆非

## 规则
1. 组合句各域独立命中。
2. 只输出 JSON，不要解释。`;

export function buildExtractUserPrompt(text: string, nowCst: string, contactNames?: string[]): string {
  const catList = (Object.keys(ACTIVITY_NAMES) as (keyof typeof ACTIVITY_NAMES)[])
    .map((k) => `${k}=${ACTIVITY_NAMES[k]}`)
    .join("、");
  const contacts = contactNames?.length ? `\n已有联系人（人物识别时称呼对齐到名单原文）：${contactNames.join("、")}` : "";
  return `当前时间：${nowCst}\n分类对照：${catList}${contacts}\n用户的话：「${text}」`;
}

/** 修复重问：把上次输出与校验错误清单拼进消息，让模型自查修正（结构化输出修复） */
export function buildRepairUserPrompt(base: string, badOutput: string, issues: string[]): string {
  return `${base}\n\n你上次的输出未通过校验，错误清单：\n${issues.map((s) => `- ${s}`).join("\n")}\n上次输出：\n${badOutput.slice(0, 1500)}\n\n请修正以上问题后重新输出完整 JSON（结构不变，只输出 JSON）。`;
}

// ============ 单域模式（识别菜单点某域重识别）：只判本域，注意力集中更准更省 ============

export const DOMAIN_PROMPTS: Record<string, string> = {
  schedule: `你是"拾光复利"App 的日程识别引擎。判断这句话是否发生了/正在做某件具体的"事"，只输出 schedule 域 JSON。

## 判定标准
- applicable=true：有具体动作——「刚跑完步」「下午开了三小时会」「7点半到8点半通勤」「中午和小李吃饭」
- false：纯感想（今天有点累）、饮食摄入（喝了两杯咖啡→diet 域）、未来计划（明天三点看牙→todo 域）
- true 时 start/end 必填（"YYYY-MM-DDTHH:MM" 北京时间，按「当前时间」推算实际日期）：显式起止按话术；大概时段给合理区间；刚发生→end=当前时间、start=end-durationMin；跨天 end 给次日；补记昨天填昨天日期。**话术没提任何日期词时日期一律=今天，结束钟点未到也不许挪到明天（如 17:22 说"下午2点到6点"→今天 14:00–18:00）**
- 量词不是钟点（"一点点/两杯/有点"）
- title ≤8字必填；durationMin 话术明确才给否则按常识估；confidence 必填
- 分类：sleep 睡眠/work 工作/study 学习/fitness 健身/social 社交/fun 娱乐/chores 家务/commute 通勤/other

## 示例
「7点半到8点半 通勤+读书」(当前09:15) → {"reasoning":"显式起止的具体活动","schedule":{"applicable":true,"activity":"commute","title":"通勤读书","start":"<今天日期>T07:30","end":"<今天日期>T08:30","durationMin":60,"confidence":0.95}}
「今天喝了两杯咖啡」→ {"reasoning":"饮食摄入非日程","schedule":{"applicable":false,"activity":"other","title":"","start":null,"end":null,"durationMin":null,"confidence":0.9}}

只输出 JSON：{"reasoning":"一句话","schedule":{上述结构}}`,
  todo: `你是"拾光复利"App 的待办识别引擎。判断这句话是否包含未来才做的计划，只输出 todo 域 JSON。

## 判定标准
- 先对照「当前时间」：钟点已过（"今天9:10到9:30工作准备"现在11:50）→ 已发生的事，false
- true：「明天下午三点看牙」「待会儿倒垃圾」「下周三要开会」「打算/准备去做/记得去做」（动词性）
- false：已发生、习惯陈述（我经常跑步）、名词性（工作计划/准备工作）、饮食摄入
- true 时 due 必填（"YYYY-MM-DDTHH:MM"）：明天15:00；"待会儿"=当前+1小时；"下周三"给工作时段合理钟点

## 示例
「明天下午三点看牙」→ {"reasoning":"明确的未来计划带钟点","todo":{"applicable":true,"due":"<明天日期>T15:00","confidence":0.95}}
「刚跑完步」→ {"reasoning":"已发生","todo":{"applicable":false,"due":null,"confidence":0.9}}

只输出 JSON：{"reasoning":"一句话","todo":{上述结构}}`,
  finance: `你是"拾光复利"App 的收支识别引擎。判断这句话是否提到具体金额的收支，只输出 finance 域 JSON。

## 判定标准
- true：「花了260」「随了600块礼」「退款到账50」「午饭28」
- false：「这东西好贵啊」（无金额）、「攒钱好难」
- true 时 amountCents（元×100 正整数）与 direction 必填：花了/买了/付了/消费→out；收到/到账/工资/红包/退款/报销→in
- category：餐饮/交通/人情往来（随礼份子）/学习/购物/娱乐/其他；counterparty=交易对象或null

## 示例
「随了600块礼给老王」→ {"reasoning":"明确金额的人情支出","finance":{"hasAmount":true,"direction":"out","amountCents":60000,"category":"人情往来","counterparty":"老王","confidence":0.95}}
「今天好省钱」→ {"reasoning":"无具体金额","finance":{"hasAmount":false,"direction":null,"amountCents":null,"category":null,"counterparty":null,"confidence":0.9}}

只输出 JSON：{"reasoning":"一句话","finance":{上述结构}}`,
  mood: `你是"拾光复利"App 的心情识别引擎。判断这句话是否带情绪色彩，只输出 mood 域 JSON。

## 判定标准
- true：「挺开心的」「累死了」「好焦虑」「吃得满足」——情绪可能藏在动作里
- false：纯客观陈述「下午开了个会」→ label=null
- label 非空则 score 必填：-100~100，积极为正消极为负越强绝对值越大（开心60/累-40/焦虑-60/兴奋80/平静10）

## 示例
「累死了终于把报告写完了」→ {"reasoning":"强疲惫情绪","mood":{"label":"疲惫","score":-40,"confidence":0.95}}
「下午开了个会」→ {"reasoning":"无情绪词","mood":{"label":null,"score":null,"confidence":0.9}}

只输出 JSON：{"reasoning":"一句话","mood":{上述结构}}`,
  diet: `你是"拾光复利"App 的饮食识别引擎。判断这句话是否提到吃了/喝了具体食物饮品，只输出 diet 域 JSON。

## 判定标准
- true：「一碗牛肉面」「喝了杯奶茶」「两杯黑咖啡和一点点香芋条」
- false：「喝了口水」（白水不计）、「买了瓶水」
- items 按食物拆多条，name 是 2-16 字食物名词（"黑咖啡"对；"今天喝了两杯黑咖啡两杯豆"错——禁止整句片段）
- kcal 尽力估算整数：米饭一碗≈200、牛肉面≈450、奶茶≈350、苹果≈80、汉堡≈550、豆浆≈120、包子≈220、烧烤≈800、黑咖啡≈10；完全不认识才 null
- meal：早餐/午餐/晚餐/加餐/夜宵/未知；true 时 items 不能为空

## 示例
「今天喝了两杯黑咖啡两杯豆浆和一点点香芋条」→ {"reasoning":"明确饮品零食摄入","diet":{"applicable":true,"meal":"加餐","items":[{"name":"黑咖啡","amount":"2杯","kcal":10},{"name":"豆浆","amount":"2杯","kcal":240},{"name":"香芋条","amount":"一点","kcal":300}],"totalKcal":550,"confidence":0.9}}
「刚开完会」→ {"reasoning":"无食物","diet":{"applicable":false,"meal":"未知","items":[],"totalKcal":null,"confidence":0.9}}

只输出 JSON：{"reasoning":"一句话","diet":{上述结构}}`,
  people: `你是"拾光复利"App 的人物识别引擎。找出这句话提到的具体人物，只输出 people 数组。

## 判定标准
- 提取具体人名/称谓：老王、小李、张老师、同事小陈
- **合称必须拆成多条，一个人一条**：「爸妈/父母/二老」→「爸爸」+「妈妈」两条；「老爸老妈」→「老爸」+「老妈」；「公婆/岳父岳母」→「公公」+「婆婆」；只提一位（爸/妈/老妈/老爸）就输出一条
- **人物对齐用户已有联系人**（用户消息会给出名单）：话术人物若是名单中某人的称呼变体（爸/老爸/父亲→「爸爸」，妈/母亲→「妈妈」，老李/李哥→「李哥」等），name 必须用**名单里的名字原文**；名单确实没有的才按话术风格命名
- event 描述关系动作：吃饭/送礼/通话/帮忙/见面/请客…（话术没有就 null）
- 没有人物输出 []；禁止输出"省略/无"等占位词

## 示例（用户已有联系人：老爸、老妈、张阿姨）
「中午和小李吃饭花了260」→ {"reasoning":"名单里没有小李，按话术命名","people":[{"name":"小李","event":"吃饭"}]}
「晚上陪爸妈吃了顿饭」→ {"reasoning":"爸妈拆两条并对齐已有称呼","people":[{"name":"老爸","event":"吃饭"},{"name":"老妈","event":"吃饭"}]}
「给老妈打了个电话」→ {"reasoning":"妈对齐已有联系人老妈","people":[{"name":"老妈","event":"通话"}]}
「陪张阿姨逛街了」→ {"reasoning":"对齐已有联系人","people":[{"name":"张阿姨","event":"见面"}]}
「今天好累」→ {"reasoning":"无人物","people":[]}

只输出 JSON：{"reasoning":"一句话","people":[...]}`,
};
