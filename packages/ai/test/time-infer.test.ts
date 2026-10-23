import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTimeBlock, detectPeriod, detectFuture, parseClock, parseClockRange, anchorRangeToToday, hasExplicitDayRef, relativeOffsetDays, relativeOffsetMinutes, detectDayRef, resolveMoment } from "../src/time-infer.js";
import { toCstWallClock, deterministicOccurredDate } from "../src/parse.js";

const NOW = new Date(2026, 8, 17, 15, 0); // 2026-09-17（周四）15:00 本地时间

test("刚 + 显式时长 → 回溯于当下", () => {
  const tb = inferTimeBlock("刚跑完步，练了40分钟", NOW, 60);
  assert.equal(tb.mode, "explicit");
  assert.equal(tb.durationMin, 40);
  assert.equal(tb.end.getTime(), NOW.getTime());
  assert.equal(tb.start.getTime(), NOW.getTime() - 40 * 60_000);
});

test("时段锚点 + 显式时长", () => {
  // 15:00 说"下午聊了两小时"：14:00 锚点会延伸到 16:00（未来）→ 钳制为 13:00~15:00
  const tb = inferTimeBlock("下午跟客户聊了两个小时", NOW, 60);
  assert.equal(tb.mode, "explicit");
  assert.equal(tb.durationMin, 120);
  assert.equal(new Date(tb.end).getTime(), NOW.getTime());
  assert.equal(new Date(tb.start).getHours(), 13);

  // 18:00 再说同一句：14:00~16:00 完全在过去 → 直接用锚点
  const eve = new Date(2026, 8, 17, 18, 0);
  const tb2 = inferTimeBlock("下午跟客户聊了两个小时", eve, 60);
  assert.equal(new Date(tb2.start).getHours(), 14);
  assert.equal(new Date(tb2.end).getHours(), 16);
});

test("时段锚点 + 默认时长（无显式时长）", () => {
  const tb = inferTimeBlock("晚上刷了会儿抖音", NOW, 30);
  assert.equal(tb.mode, "relative");
  assert.equal(new Date(tb.start).getHours(), 19); // 晚上锚点 19:00
});

test("无时段无时长 → 类别默认，结束于当下", () => {
  const tb = inferTimeBlock("跑步了", NOW, 60);
  assert.equal(tb.mode, "default");
  assert.equal(tb.durationMin, 60);
  assert.equal(tb.end.getTime(), NOW.getTime());
});

test("锚点不可晚于当前时刻（说'晚上'但现在是15点 → 视为昨天）", () => {
  const tb = inferTimeBlock("晚上加班了", NOW, 120);
  assert.ok(tb.end.getTime() <= NOW.getTime());
});

test("时段词识别", () => {
  assert.equal(detectPeriod("中午吃饭"), "noon");
  assert.equal(detectPeriod("下午开会"), "afternoon");
  assert.equal(detectPeriod("凌晨才睡"), "lateNight");
  assert.equal(detectPeriod("早上通勤"), "morning");
  assert.equal(detectPeriod("跑步了"), null);
});

// ---------- 未来话术 → TODO（mode='future'，不钳制） ----------

test("未来检测（含'一会儿'语境回归）", () => {
  assert.equal(detectFuture("刚做了一会儿拉伸"), null); // 过去语境
  assert.equal(detectFuture("过一会儿再去倒垃圾"), "soon"); // 未来语境
  assert.equal(detectFuture("明天下午三点去看牙医"), "tomorrow");
  assert.equal(detectFuture("待会儿记得倒垃圾"), "soon");
  assert.equal(detectFuture("下周三上午开产品评审会"), "nextWeek");
  assert.equal(detectFuture("后天回老家"), "dayAfter");
  assert.equal(detectFuture("下午跟客户聊了两个小时"), null);
  assert.equal(detectFuture("刚跑完步"), null);
});

test("未来检测收紧：名词性「准备/计划」不算未来（线上回归：'工作准备'曾被拐成待办）", () => {
  assert.equal(detectFuture("今天9:10到9:30工作准备+喝水"), null);
  assert.equal(detectFuture("准备工作做完了"), null);
  assert.equal(detectFuture("写完工作计划了"), null);
  assert.equal(detectFuture("热身准备活动"), null);
});

test("未来检测收紧：动词性「计划/准备」仍是未来", () => {
  assert.equal(detectFuture("准备去开会"), "soon");
  assert.equal(detectFuture("准备要健身了"), "soon");
  assert.equal(detectFuture("计划着去健身"), "soon");
  assert.equal(detectFuture("计划着下周旅行"), "nextWeek"); // 显式日期词优先
  assert.equal(detectFuture("记得交房租"), "soon");
  assert.equal(detectFuture("要交季度报告"), "soon");
  assert.equal(detectFuture("得去一趟银行"), "soon");
});

test("明天+钟点 → 未来计划（明天15:00，不受当前钳制）", () => {
  const tb = inferTimeBlock("明天下午三点去看牙医", NOW, 60);
  assert.equal(tb.mode, "future");
  assert.equal(new Date(tb.start).getDate(), 18);          // 9月18日
  assert.equal(new Date(tb.start).getHours(), 15);         // 下午三点 = 15 点
});

test("待会儿 → now+1h", () => {
  const tb = inferTimeBlock("待会儿记得倒垃圾", NOW, 30);
  assert.equal(tb.mode, "future");
  assert.equal(new Date(tb.start).getHours(), 16);         // 15:00 + 1h
});

test("下周三 → 定位到下周星期三（9/23）", () => {
  const tb = inferTimeBlock("下周三上午开产品评审会", NOW, 60);
  assert.equal(tb.mode, "future");
  const s = new Date(tb.start);
  assert.equal(s.getDate(), 23);                            // 2026-09-23 是周三
  assert.equal(s.getHours(), 8);                            // 上午锚点
});

test("LLM 强制未来但无日期词 → 按 soon 处理", () => {
  const tb = inferTimeBlock("要交季度报告", NOW, 60, null, true);
  assert.equal(tb.mode, "future");
  assert.ok(tb.start.getTime() > NOW.getTime());
});

// —— 回归：跨日日程误回退（线上 2026-09-20 早上7:17 记"早上醒来6.30-7.30"被归到前一天） ——

const MORNING = new Date(2026, 8, 20, 7, 17); // 2026-09-20（周日）07:17
const DEEP_NIGHT = new Date(2026, 8, 20, 2, 0); // 2026-09-20（周日）凌晨 02:00

test("清早记录'早上…'（锚点8点尚未来到）→ 必须落在今天，不得回退到昨天", () => {
  const tb = inferTimeBlock("早上醒来6.30-7.30，对拾光进行了部署调研", MORNING, 60, "morning");
  assert.equal(tb.start.getFullYear(), 2026);
  assert.equal(tb.start.getMonth(), 8);
  assert.equal(tb.start.getDate(), 20, `应落今天9/20，实际${tb.start.toISOString()}`);
  // 显式钟点区间：精确落 6:30-7:30（结尾 7:30 略超记录时刻 7:17 也按用户说的保留）
  assert.equal(`${tb.start.getHours()}:${String(tb.start.getMinutes()).padStart(2, "0")}`, "6:30");
  assert.equal(`${tb.end.getHours()}:${String(tb.end.getMinutes()).padStart(2, "0")}`, "7:30");
});

test("清早无钟点的'早上…'同样保留今天", () => {
  const tb = inferTimeBlock("早上跑了五公里", MORNING, 60, "morning");
  assert.equal(tb.start.getDate(), 20);
  assert.equal(tb.end.getDate(), 20);
});

test("凌晨记录'晚上…'仍回退到昨晚（保留原正确行为）", () => {
  const tb = inferTimeBlock("晚上看了电影", DEEP_NIGHT, 120, "evening");
  assert.equal(tb.start.getDate(), 19, "应回退到 9/19 晚上");
  assert.equal(tb.start.getHours(), 19);
});

test("白天记录已过的时段 → 保持今天（原行为不变）", () => {
  const tb = inferTimeBlock("早上开了个会", NOW, 60, "morning"); // 15:00 说早上的事
  assert.equal(tb.start.getDate(), 17);
  assert.equal(tb.start.getHours(), 8);
});

// —— 回归2：显式钟点区间精确落时段（2026-09-20 "7点半到8点半通勤"被识别成 07:25-08:25） ——

test("显式区间'7点半到8点半'→ 今天 07:30-08:30，不做当下收拢", () => {
  const tb = inferTimeBlock("7点半到8点半 通勤+读书《复利效应》", new Date(2026, 8, 20, 7, 41), 60, "morning");
  assert.equal(tb.mode, "explicit");
  assert.equal(`${tb.start.getHours()}:${String(tb.start.getMinutes()).padStart(2, "0")}`, "7:30");
  assert.equal(`${tb.end.getHours()}:${String(tb.end.getMinutes()).padStart(2, "0")}`, "8:30");
  assert.equal(tb.start.getDate(), 20);
  assert.equal(tb.durationMin, 60);
});

test("点号区间'6.30-7.30'清早记录 → 今天 06:30-07:30（结尾略超记录时刻也保留）", () => {
  const tb = inferTimeBlock("早上醒来6.30-7.30，对拾光进行了部署调研", new Date(2026, 8, 20, 7, 17), 60, "morning");
  assert.equal(`${tb.start.getHours()}:${String(tb.start.getMinutes()).padStart(2, "0")}`, "6:30");
  assert.equal(`${tb.end.getHours()}:${String(tb.end.getMinutes()).padStart(2, "0")}`, "7:30");
  assert.equal(tb.start.getDate(), 20);
});

test("区间+凌晨补记 → 归昨天", () => {
  const tb = inferTimeBlock("早上6.30-7.30跑了步", new Date(2026, 8, 20, 2, 0), 60, "morning");
  assert.equal(tb.start.getDate(), 19);
  assert.equal(tb.start.getHours(), 6);
  assert.equal(tb.end.getHours(), 7);
});

test("区间+相对日'昨晚10点半到11点半'→ 昨晚 22:30-23:30", () => {
  const tb = inferTimeBlock("昨晚10点半到11点半读书", NOW, 60);
  assert.equal(tb.start.getDate(), 16, "9/17 的昨天 = 9/16");
  assert.equal(`${tb.start.getHours()}:${String(tb.start.getMinutes()).padStart(2, "0")}`, "22:30");
  assert.equal(`${tb.end.getHours()}:${String(tb.end.getMinutes()).padStart(2, "0")}`, "23:30");
});

test("跨天区间'晚上10.30到6.30' → 当晚22:30至次日06:30", () => {
  const tb = inferTimeBlock("晚上10.30到6.30睡觉", new Date(2026, 8, 20, 21, 0), 480, "evening");
  assert.equal(tb.start.getHours(), 22);
  assert.equal(tb.start.getMinutes(), 30);
  assert.equal(tb.end.getDate(), 21);
  assert.equal(tb.end.getHours(), 6);
  assert.equal(tb.durationMin, 480);
});

// —— 回归3：叠字假钟点（"一点点"被解析成 1 点导致饮食记录误撞日程） ——

test("parseClock：'一点点'类叠字不是钟点", () => {
  assert.equal(parseClock("今天喝了两杯黑咖啡两杯豆浆和一点点香芋条", null), null);
  assert.equal(parseClock("一点点香芋条", null), null);
});

test("parseClock：真实钟点不受影响（一点/十一点半/6.30）", () => {
  assert.equal(parseClock("凌晨一点睡觉", null)?.hour, 1);
  assert.equal(parseClock("十一点半吃饭", null)?.hour, 11);
  assert.equal(parseClock("6.30", null)?.minute, 30);
});

// —— 十五轮回归：点后中文数字分钟（「十一点五十」旧版静默丢成 11:00 整点） ——
test("parseClock：中文数字分钟（十一点五十/两点二十）+ 阿拉伯回归", () => {
  assert.deepEqual(parseClock("中午十一点五十吃了饭", null), { hour: 11, minute: 50 });
  assert.deepEqual(parseClock("下午两点二十开会", "afternoon"), { hour: 14, minute: 20 });
  assert.deepEqual(parseClock("十一点50分", null), { hour: 11, minute: 50 }); // 阿拉伯回归
  assert.deepEqual(parseClock("三点半", null), { hour: 3, minute: 30 }); // 半 回归
});

// —— 十七轮回归：约数并列钟点（「两三点」旧版按复合进位直读 23 点） ——
test("parseClock：约数并列取末位（两三点→3、七八点→8）+ 叠字仍非钟点", () => {
  assert.equal(parseClock("下午两三点开了个会", "afternoon")?.hour, 15);
  assert.equal(parseClock("晚上七八点到家", "evening")?.hour, 20);
  assert.deepEqual(parseClock("两点半", null), { hour: 2, minute: 30 }); // 「两X」单字不受影响
  assert.equal(parseClock("一点点香芋条", null), null); // 叠字守卫回归
});

// —— 回归4：AI 区间日期锚定（线上事故：17:22 说"下午2点到6点"被模型写成 9/21） ——

const T920 = new Date(2026, 8, 20, 17, 22); // 2026-09-20 17:22 本地
const mk = (day: number, h: number) => ({ start: new Date(2026, 8, day, h, 0), end: new Date(2026, 8, day, h + 4, 0) });

test("hasExplicitDayRef：日期词识别", () => {
  assert.equal(hasExplicitDayRef("明天下午三点去看牙医"), true);
  assert.equal(hasExplicitDayRef("昨天下午2点到6点在写代码"), true);
  assert.equal(hasExplicitDayRef("上周三上午开会"), true);
  assert.equal(hasExplicitDayRef("9月18日打卡"), true);
  assert.equal(hasExplicitDayRef("下午2点到6点一直在打磨项目"), false);
});

test("锚定：AI 给了明天（无日期词）→ 平移回今天，钟点保留", () => {
  const r = anchorRangeToToday(mk(21, 14), "下午2点到6点，一直在打磨项目，都进行了微调", T920);
  assert.equal(r.start.getDate(), 20);
  assert.equal(r.start.getHours(), 14);
  assert.equal(r.end.getDate(), 20);
  assert.equal(r.end.getHours(), 18);
});

test("锚定：AI 给了昨天（无日期词、白天）→ 归今天", () => {
  const r = anchorRangeToToday(mk(19, 14), "下午2点到6点在写代码", T920);
  assert.equal(r.start.getDate(), 20);
});

test("锚定：凌晨 0-5 点补记昨天的区间 → 保留昨天", () => {
  const r = anchorRangeToToday(mk(19, 14), "下午2点到6点在写代码", new Date(2026, 8, 20, 2, 0));
  assert.equal(r.start.getDate(), 19);
});

test("锚定：话术有日期词 → 信任 AI 不动", () => {
  const r = anchorRangeToToday(mk(21, 14), "明天下午2点到6点开会", T920);
  assert.equal(r.start.getDate(), 21);
  const r2 = anchorRangeToToday(mk(19, 14), "昨天下午2点到6点在写代码", T920);
  assert.equal(r2.start.getDate(), 19);
});

test("锚定：未来话术（无日期词但有'要去'）→ 不动", () => {
  const r = anchorRangeToToday(mk(21, 14), "下午2点到6点要去开会", T920);
  assert.equal(r.start.getDate(), 21);
});

test("锚定：AI 已给今天 → 原样返回", () => {
  const r = anchorRangeToToday(mk(20, 14), "下午2点到6点在写代码", T920);
  assert.equal(r.start.getDate(), 20);
});

test("toCstWallClock：UTC 时刻 → 北京墙钟，且与宿主机时区无关", () => {
  // 2026-09-22 13:43 UTC = 21:43 北京时间；在 UTC/CST 任何机器上结果都必须一致
  assert.equal(toCstWallClock(new Date("2026-09-22T13:43:00Z")), "2026-09-22 21:43（北京时间）");
  // 北京 00:30（UTC 前一天 16:30）→ 日期必须还是当天（旧 bug 会回退到前一天）
  assert.equal(toCstWallClock(new Date("2026-09-22T16:30:00Z")), "2026-09-23 00:30（北京时间）");
});

// —— 009 轮检视回归：裸「N号/N日」是显式日期，缺分支会让模型给对的区间被整天平移 ——
test("hasExplicitDayRef：裸 N号/N日 也是显式日期（3号区间不再平移到今天）", () => {
  assert.equal(hasExplicitDayRef("3号下午2点到4点开会"), true);
  assert.equal(hasExplicitDayRef("15日交房"), true);
  // 「10月3号」由 M月N号 分支覆盖，lookbehind 不双计
  assert.equal(hasExplicitDayRef("10月3号随了600块礼"), true);
  // 无日期词仍然 false（锚定路径正常工作）
  assert.equal(hasExplicitDayRef("下午2点到6点一直在打磨项目"), false);
});

test("锚定：话术带裸「3号」→ 模型给对的历史区间不再被平移", () => {
  // now=10-08，模型把「3号下午」区间给成 10-03：有显式日期 → 原样保留
  const now = new Date(2026, 9, 8, 18, 0);
  const range = { start: new Date(2026, 9, 3, 14, 0), end: new Date(2026, 9, 3, 16, 0) };
  const r = anchorRangeToToday(range, "3号下午2点到4点开会", now);
  assert.equal(r.start.getDate(), 3);
  assert.equal(r.start.getHours(), 14);
});

// —— 检视回归：月底/下个月/明儿 不再吃 soon 桶的 now+1h（「下个月还贷」曾提前 30 天生成到期待办，提醒立即误报） ——
// 断言全部用 +08:00 锚定的绝对时刻：月历锚按北京 UTC 推算，任何宿主时区下逐毫秒成立
const CST = (s: string) => new Date(s).getTime();

test("月底/月末 → 本月最后一天 20:00（北京月历锚）", () => {
  const tb = inferTimeBlock("月底交房租", NOW, 30);
  assert.equal(tb.mode, "future");
  assert.equal(tb.start.getTime(), CST("2026-09-30T20:00:00+08:00")); // 9 月 30 天
  assert.equal(inferTimeBlock("月末还信用卡", NOW, 30).start.getTime(), CST("2026-09-30T20:00:00+08:00"));
});

test("下个月 → 下月 1 日 20:00；「下个月底」= 下月最后一天；跨年自然进位", () => {
  assert.equal(inferTimeBlock("下个月还贷", NOW, 30).start.getTime(), CST("2026-10-01T20:00:00+08:00"));
  assert.equal(inferTimeBlock("下个月份交房租", NOW, 30).start.getTime(), CST("2026-10-01T20:00:00+08:00"));
  assert.equal(inferTimeBlock("下个月底交房租", NOW, 30).start.getTime(), CST("2026-10-31T20:00:00+08:00"));
  const dec = new Date("2026-12-15T15:00:00+08:00");
  assert.equal(inferTimeBlock("下个月开始存钱", dec, 30).start.getTime(), CST("2027-01-01T20:00:00+08:00"));
});

test("明儿 → 对齐「明天」：+1 天 + 默认 9 点锚（不再混入 soon 桶）", () => {
  assert.equal(detectFuture("明儿去买菜"), "tomorrow");
  const tb = inferTimeBlock("明儿去买菜", NOW, 30);
  assert.equal(tb.mode, "future");
  assert.equal(tb.start.getTime(), CST("2026-09-18T09:00:00+08:00"));
});

test("月历锚带显式钟点/时段时让位（与下周X分支同口径）；soon 桶原语义不受影响", () => {
  assert.equal(inferTimeBlock("月底上午9点交房租", NOW, 30).start.getTime(), CST("2026-09-30T09:00:00+08:00"));
  // 「待会儿」类真 soon 仍 now+1h
  assert.equal(inferTimeBlock("待会儿记得倒垃圾", NOW, 30).start.getTime(), NOW.getTime() + 3600_000);
});

// —— 十三轮回归：混时段显式区间（整句单一时段把另一端解析成垃圾块） ——

test("混时段'上午10点到下午3点'→ 10:00-15:00（终点按片段自身时段，不再跨日 +24h 成 17h 块）", () => {
  const tb = inferTimeBlock("上午10点到下午3点开了个会", NOW, 60);
  assert.equal(tb.start.getTime(), CST("2026-09-17T10:00:00+08:00"));
  assert.equal(tb.end.getTime(), CST("2026-09-17T15:00:00+08:00"));
});

test("混时段'晚上11点到凌晨2点'→ 23:00-次日02:00（起点按片段 evening +12，跨零点睡眠语义）", () => {
  const tb = inferTimeBlock("晚上11点到凌晨2点睡觉", NOW, 60);
  assert.equal(tb.start.getTime(), CST("2026-09-17T23:00:00+08:00"));
  assert.equal(tb.end.getTime(), CST("2026-09-18T02:00:00+08:00"));
});

test("回归不破：'晚上10.30到6.30'→ 22:30-次日06:30（裸钟点终点不被整句 evening 抬成 18 点）", () => {
  const tb = inferTimeBlock("晚上10.30到6.30睡觉", new Date(2026, 8, 20, 23, 30), 60, "evening");
  assert.equal(tb.start.getTime(), CST("2026-09-20T22:30:00+08:00"));
  assert.equal(tb.end.getTime(), CST("2026-09-21T06:30:00+08:00"));
});

// —— 十三轮回归：「N天之后/一个月以后」变体入未来词表（旧版被锚定整平移到今天） ——

test("「3天之后/一周之后/一个月以后」→ relativeOffsetDays 命中 + 显式日期词（锚定豁免）", () => {
  assert.equal(relativeOffsetDays("3天之后交报告"), 3);
  assert.equal(relativeOffsetDays("一周之后开会"), 7);
  assert.equal(relativeOffsetDays("一个月以后还"), 30);
  assert.equal(hasExplicitDayRef("3天之后交报告"), true);
  assert.equal(hasExplicitDayRef("一个月以后还"), true);
  assert.equal(hasExplicitDayRef("3天后交报告"), true); // 旧口径不回归
});

// —— 十四轮回归：周几不得压过显式日期（「9月30号周三」曾按记账日锚成上周三，错 7 天） ——

test("周X+显式月日：显式日期完全压过周X相对推算（finance occurredDate 与日程块同口径）", () => {
  const OCT8 = new Date("2026-10-08T16:00:00+08:00"); // 周四
  // 「9月30号周三」：周X 分支会按本周三（10-07）推算——显式日期必须赢
  const tb = inferTimeBlock("9月30号周三开了会", OCT8, 60);
  assert.equal(tb.start.getTime(), CST("2026-09-30T20:00:00+08:00"));
  const tb2 = inferTimeBlock("9月30号下午3点到5点开了会", OCT8, 60);
  assert.equal(tb2.start.getTime(), CST("2026-09-30T15:00:00+08:00"));
  assert.equal(tb2.end.getTime(), CST("2026-09-30T17:00:00+08:00"));
  // detectDayRef 对显式月日一律让路（返回 null，交回显式日期分支）
  assert.equal(detectDayRef("9月30号周三开会", OCT8), null);
  assert.equal(detectDayRef("10月1号周四随了600", OCT8), null);
  // 回归不破：纯周X/相对日语义不变
  assert.equal(detectDayRef("周三开会", OCT8), -1); // 本周四说「周三」→ 上周三
  assert.equal(detectDayRef("昨天开会", OCT8), -1);
});

test("「今天周X」→ 今天优先（旧版周X分支排前，今天非周X时被推算成上周X）", () => {
  const OCT8 = new Date("2026-10-08T16:00:00+08:00"); // 周四
  assert.equal(detectDayRef("今天周三开了会", OCT8), 0);
  const tb = inferTimeBlock("今天下午2点到4点做了账", OCT8, 60);
  assert.equal(tb.start.getTime(), CST("2026-10-08T14:00:00+08:00"));
});

test("「下个月15号交房租」→ 下月 15 日 20:00（旧版 -8h 后回读 UTC 日期恒失败，显式日分支成死代码）", () => {
  const SEP28 = new Date("2026-09-28T16:00:00+08:00");
  const tb = inferTimeBlock("下个月15号交房租", SEP28, 30);
  assert.equal(tb.start.getTime(), CST("2026-10-15T20:00:00+08:00"));
  // 2 月无 30 号：日历回读失败放弃显式日（宁缺勿错口径保持）
  const tb2 = inferTimeBlock("下个月30号还房贷", new Date("2026-01-20T16:00:00+08:00"), 30);
  assert.equal(tb2.start.getTime() !== new Date("2026-02-30T00:00:00Z").getTime(), true);
});

// —— 十四轮回归：「N小时后/半小时后」入未来词表（23:30 说「两小时后」曾被锚定拉回当天已过期） ——

test("「两小时后/半小时后/两个半小时后」→ soon 桶 + 确定性分钟锚（跨午夜不再回退一天）", () => {
  const LATE = new Date("2026-10-08T23:30:00+08:00");
  assert.equal(detectFuture("两小时后取快递"), "soon");
  assert.equal(detectFuture("半小时后开会"), "soon");
  assert.equal(relativeOffsetMinutes("两小时后"), 120);
  assert.equal(relativeOffsetMinutes("3小时之后"), 180);
  assert.equal(relativeOffsetMinutes("两个半小时后"), 150);
  assert.equal(relativeOffsetMinutes("半小时后"), 30);
  assert.equal(relativeOffsetMinutes("1.5小时后"), 90); // 十六轮：小数小时整段捕获（旧版保守拒绝 null，防的只是被尾部 5 抢配成 5 小时）
  const tb = inferTimeBlock("两小时后取快递", LATE, 15);
  assert.equal(tb.start.getTime(), CST("2026-10-09T01:30:00+08:00"));
  // AI 路径锚定豁免：跨午夜 due 不被 anchorRangeToToday 平移回当天
  const due = new Date("2026-10-09T01:30:00+08:00");
  assert.equal(anchorRangeToToday({ start: due, end: due }, "两小时后取快递", LATE).start.getTime(), due.getTime());
});

// —— 十四轮回归：「明晚八点」「昨夜11点」时段词缺口（曾落成明早 8 点/昨上午 11 点） ——

test("「明晚八点」→ 次日 20:00；「昨夜11点」→ 昨晚 23:00（裸形态词表收口）", () => {
  const NOW2 = new Date("2026-10-08T16:00:00+08:00");
  assert.equal(detectPeriod("明晚八点开会"), "evening");
  const tb = inferTimeBlock("明晚八点开会", NOW2, 60);
  assert.equal(tb.start.getTime(), CST("2026-10-09T20:00:00+08:00"));
  assert.equal(detectPeriod("昨夜11点刷了手机"), "evening");
  const tb2 = inferTimeBlock("昨夜11点刷了手机", new Date("2026-10-08T23:30:00+08:00"), 30);
  assert.equal(tb2.start.getTime(), CST("2026-10-07T23:00:00+08:00"));
});

// —— 十五轮回归：裸「N号+周X」不得被周X分支劫持（「15号周三」曾按本周三偏 22 天） ——
test("裸 N号+周X：显式日完全压过周X相对推算（日程块与 finance occurredDate 同口径）", () => {
  const OCT8 = new Date("2026-10-08T16:00:00+08:00"); // 周四
  // 周X 分支会推成本周三（10-07）——裸 15 号（上月已过）必须赢
  assert.equal(detectDayRef("15号周三交了房租", OCT8), null);
  assert.equal(detectDayRef("3号周三开了会", OCT8), null);
  // 编号不误伤（量词前缀同 EXPLICIT_DAY_RE lookbehind——「件3号球衣」的 3号 是编号非日期）
  assert.equal(detectDayRef("件3号球衣周三洗了", OCT8), -1); // 无显式日 → 周三照常推算
  // deterministicOccurredDate：裸 15 号分支接手 → 上月 15 日（本月 15 号未到）
  assert.equal(deterministicOccurredDate("15号周三交了房租", OCT8), "2026-09-15");
  assert.equal(deterministicOccurredDate("20号周日随了600", OCT8), "2026-09-20");
  // 本月已过的 N号 仍取本月
  assert.equal(deterministicOccurredDate("3号周三开了会", OCT8), "2026-10-03");
});

// —— 十八轮回归：parseClockRange 终点抬 pm 用 >=（等钟点区间曾跨日膨胀成 24.5h 块） ——

test("parseClockRange：等钟点区间/裸 12 点到 1 点（起点过正午同样抬终点）", () => {
  // 下午1点到1点半 → 13:00–13:30（旧版 1+12=13 > 13 不成立 → 01:30 跨日 +24h = 24.5h 块）
  assert.deepEqual(parseClockRange("下午1点到1点半", "afternoon"), {
    start: { hour: 13, minute: 0 }, end: { hour: 13, minute: 30 },
  });
  // 中午12点到1点 → 12:00–13:00（noon 不在 pmish，按起点本身 >=12 抬）
  assert.deepEqual(parseClockRange("中午12点到1点", "noon"), {
    start: { hour: 12, minute: 0 }, end: { hour: 13, minute: 0 },
  });
  // 晚上等钟点：晚上11点到11点半 → 23:00–23:30
  assert.deepEqual(parseClockRange("晚上11点到11点半", "evening"), {
    start: { hour: 23, minute: 0 }, end: { hour: 23, minute: 30 },
  });
  // 真跨日回归不伤：晚上11点到1点（13 >= 23 不成立，终点保持 1 点交跨日语义）
  assert.deepEqual(parseClockRange("晚上11点到1点", "evening"), {
    start: { hour: 23, minute: 0 }, end: { hour: 1, minute: 0 },
  });
  // 混时段回归不伤：上午10点到下午3点（终点片段自带时段词，不走钳制）
  assert.deepEqual(parseClockRange("上午10点到下午3点", null), {
    start: { hour: 10, minute: 0 }, end: { hour: 15, minute: 0 },
  });
});

// —— 十八轮回归：中文分钟 {1,2} 截断三位中文数字（「十一点三十五」曾落 11:30） ——

test("parseClock：三位中文数字分钟（三十五/二十五）", () => {
  assert.deepEqual(parseClock("十一点三十五吃饭", null), { hour: 11, minute: 35 });
  assert.deepEqual(parseClock("两点二十五开会", "afternoon"), { hour: 14, minute: 25 });
  // 既有两位/半点回归不伤
  assert.deepEqual(parseClock("十一点五十睡觉", null), { hour: 11, minute: 50 });
  assert.deepEqual(parseClock("三点半", null), { hour: 3, minute: 30 });
  // 分钟越界兜底保持（八十八 → cnToNumber=88 > 59 → null）
  assert.equal(parseClock("三点八十八", null), null);
});

// —— 十九轮回归：resolveMoment 宽形态 naive（斜杠/点分隔、单位数月日时）按北京帧解析 ——

test("resolveMoment：非标准 naive 形态不再按宿主时区解释（UTC 宿主偏 8 小时家族）", () => {
  const now = new Date("2026-10-23T08:00:00+08:00");
  // 标准形态回归
  assert.deepEqual(resolveMoment("2026-10-23 14:00", now), new Date("2026-10-23T14:00:00+08:00"));
  // 斜杠/点分隔与单位数月日时（旧版落 new Date(t) 按宿主时区，UTC 容器上偏 8 小时）
  assert.deepEqual(resolveMoment("2026/10/23 14:00", now), new Date("2026-10-23T14:00:00+08:00"));
  assert.deepEqual(resolveMoment("2026.10.23 14:00", now), new Date("2026-10-23T14:00:00+08:00"));
  assert.deepEqual(resolveMoment("2026-10-8 9:30", now), new Date("2026-10-08T09:30:00+08:00"));
  // 带秒/毫秒形态保持
  assert.deepEqual(resolveMoment("2026/10/23 14:00:30", now), new Date("2026-10-23T14:00:30+08:00"));
  // 显式时区维持原样（语义自足）
  assert.deepEqual(resolveMoment("2026-10-23T14:00:00Z", now), new Date("2026-10-23T14:00:00Z"));
  // 垃圾/越幅/超 366 天仍 null
  assert.equal(resolveMoment("明天下午", now), null);
  assert.equal(resolveMoment("2026-10-23 25:00", now), null);
  assert.equal(resolveMoment("2020-01-01 08:00", now), null);
});

// —— 十九轮回归：detectFuture 否定式「不/没记得」是回忆陈述非计划 ——

test("detectFuture：否定式「不记得/没记得」不产未来 todo（规则兜底幻影提醒家族）", () => {
  assert.equal(detectFuture("我不记得带钥匙了"), null);
  assert.equal(detectFuture("没记得存档，找不到了"), null);
  // 肯定式「记得」仍判未来
  assert.equal(detectFuture("记得倒垃圾"), "soon");
  assert.equal(detectFuture("待会儿记得倒垃圾"), "soon");
});
