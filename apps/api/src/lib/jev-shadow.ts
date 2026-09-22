/**
 * Jev 影子模式（REQ-003 3-C / FR-B2）：JEV_MODE=shadow 时，五域识别完成后 fire-and-forget
 * 用同一话术调 Jev 闭集问题组，与已落库的 GLM 结果逐字段比对，只写审计（stage='jev_shadow'）。
 * 用户行为零变化、零阻塞；shadow 行 model='jev-latest'，配额/用量统计口径已排除该模型。
 * 持续 ≥1 周后统计一致率：空间分类 ≥90% 且五域闭集 ≥85% 才进入接管（3-D）。
 */
import { jevAsk, qChoice, qNoul, type ParseResult } from "@shiguangri/ai";
import { getJevMode } from "./ai-mode";
import { writeAuditRecord } from "./audit";

const questions = {
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

/** GLM 侧时间块开始钟点 → 时段枚举（与 PoC 评分同口径；time.start 为本地时刻串） */
function hourBucket(iso: string): string {
  const h = new Date(iso).getHours();
  if (h <= 5) return "lateNight";
  if (h <= 9) return "morning";
  if (h <= 12) return "noon";
  if (h <= 16) return "afternoon";
  if (h <= 20) return "evening";
  return "night";
}

/** 影子对照：与 GLM 落库结果逐闭集字段比对，审计一行（ok=全一致，error=差异摘要）。绝不抛错。 */
export async function jevShadowCompare(userId: string, entryId: string, rawText: string, r: ParseResult): Promise<void> {
  if ((await getJevMode()) !== "shadow") return;
  const t0 = Date.now();
  try {
    const nowCst = (() => {
      const d = new Date(Date.now() + 8 * 3600_000);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}（北京时间）`;
    })();
    const state = `用户随口记录了一句话（当前时间：${nowCst}）：\n「${rawText}」`;
    const res = await jevAsk(state, questions);
    const A = (k: string) => res.answers[k]?.value ?? null;
    const mismatches: string[] = [];
    const cmp = (label: string, jevVal: unknown, glmVal: unknown) => {
      if (jevVal !== glmVal) mismatches.push(`${label}:${JSON.stringify(jevVal)}≠${JSON.stringify(glmVal)}`);
    };
    cmp("schedule", A("sched_applicable") === true, r.scheduleApplicable && r.intent === "schedule");
    cmp("todo", A("todo_applicable") === true, r.intent === "todo");
    cmp("finance", A("fin_applicable") === true, r.finance.hasAmount);
    cmp("mood", A("mood_applicable") === true, !!r.mood.label);
    cmp("diet", A("diet_applicable") === true, r.diet.applicable);
    cmp("people", A("people_applicable") === true, r.people.length > 0);
    cmp("activity", A("activity"), r.activity);
    cmp("record_type", A("record_type"), r.intent === "todo" ? "future" : "past");
    if (r.finance.hasAmount) {
      cmp("fin_direction", A("fin_direction") === "income" ? "in" : A("fin_direction"), r.finance.direction);
      cmp("fin_category", A("fin_category"), r.finance.category);
    }
    if (r.diet.applicable) cmp("diet_meal", A("diet_meal"), r.diet.meal);
    if (r.scheduleApplicable && r.time?.start) cmp("period", A("period"), hourBucket(r.time.start));
    await writeAuditRecord({
      userId, entryId, stage: "jev_shadow",
      model: process.env.JEV_MODEL ?? "jev-latest", engine: "jev-shadow",
      latencyMs: Date.now() - t0, ok: mismatches.length === 0,
      error: mismatches.length ? mismatches.slice(0, 6).join("; ") : undefined,
    });
  } catch (e) {
    // 影子失败照记审计（ok=false），主流程无感知
    await writeAuditRecord({
      userId, entryId, stage: "jev_shadow",
      model: process.env.JEV_MODEL ?? "jev-latest", engine: "jev-shadow",
      latencyMs: Date.now() - t0, ok: false, error: String(e).slice(0, 300),
    });
  }
}
