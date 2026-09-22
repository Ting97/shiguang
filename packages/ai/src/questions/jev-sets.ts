/**
 * Jev 问题组单源（REQ-003 B / 004 FR-D2.2）：影子对照（jev-shadow）与实时接管（parseHybridInput）
 * 共用同一份闭集问题字典——加问/改措辞只改这里。
 * criteria 即闭集契约：choice 的 key 就是各字段的答案枚举值。
 */
import { qChoice, qNoul, type JevQuestions } from "../jev";

/** 五域识别闭集问题组（一次调用并行全答） */
export function extractClosedSetQuestions(): JevQuestions {
  return {
    sched_applicable: qNoul("这句话记录了一个已经发生或正在进行的、有具体内容的事件或活动（不是纯感想，不是未来计划，也不只是吃喝）"),
    todo_applicable: qNoul("这句话表达了一个计划要做、还没发生的事情"),
    fin_applicable: qNoul("这句话包含有具体金额的花钱或收钱行为"),
    mood_applicable: qNoul("这句话表达了说话者的情绪或心情（情绪可能藏在动作里）"),
    diet_applicable: qNoul("这句话提到吃了或喝了具体的食物或饮品（喝白开水不算）"),
    people_applicable: qNoul("这句话提到了具体的人（称谓也算，比如爸妈、小李、张老师）"),
    activity: qChoice("如果这句话在记录一个活动，它最接近哪一类？", {
      sleep: "睡眠：睡觉、午睡、赖床补觉",
      work: "工作：开会、写周报、处理邮件、见客户、上班",
      study: "学习：看书、学英语、上课、刷题",
      fitness: "健身：跑步、撸铁、球类、瑜伽、散步锻炼",
      social: "社交：与亲友同事吃饭聊天通话、随礼帮忙",
      fun: "娱乐：刷抖音、看电影、玩游戏、逛街",
      chores: "家务：做饭、打扫、买菜、洗衣",
      commute: "通勤：上下班路上、打车地铁",
      other: "以上皆非",
    }),
    record_type: qChoice("这句话描述的是已经发生的事，还是计划要做的事？", {
      past: "已经发生或正在发生的事",
      future: "计划/将要发生的事",
    }),
    period: qChoice("这件事大致发生在什么时段？", {
      now: "当下、刚刚",
      morning: "早晨/上午",
      noon: "中午",
      afternoon: "下午",
      evening: "傍晚/晚上",
      night: "夜里",
      lateNight: "凌晨",
    }),
    fin_direction: qChoice("如果这句话涉及钱，是花钱还是收钱？", { out: "花钱/支出", income: "收钱/收入" }),
    fin_category: qChoice("如果这句话涉及钱，最接近哪个分类？", {
      餐饮: "吃饭、饮品、外卖",
      交通: "打车、地铁、公交、加油",
      人情往来: "随礼、份子钱、送礼",
      学习: "课程、书籍、培训",
      购物: "购买商品",
      娱乐: "娱乐消费",
      其他: "其他支出",
    }),
    diet_meal: qChoice("如果吃了或喝了东西，最接近哪一餐？", {
      早餐: "早餐", 午餐: "午餐", 晚餐: "晚餐", 加餐: "下午茶、零食", 夜宵: "深夜进食", 未知: "说不清",
    }),
  };
}

/** 空间归属闭集问题组（3-D：classifySpace 接管用）；candidates = { 空间id: "名称：描述" } */
export function spaceClassifyQuestions(candidates: Record<string, string>): JevQuestions {
  return {
    space_belongs: qNoul("这条记录的内容与某个长期目标（如备考、副业、训练计划）直接相关——是在推进、练习、学习它，或产生了与它直接相关的花销/人际"),
    space_which: qChoice("如果这条记录服务于某个长期目标空间，是哪一个？（拿不准宁可选「都不是」）", {
      ...candidates,
      __none__: "与任何目标空间无关，只是一般生活记录",
    }),
  };
}
