import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTimeBlock, detectPeriod, detectFuture, parseClock, parseClockRange } from "../src/time-infer.js";

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
  const tb = inferTimeBlock("早上醒来6.30-7.30，对拾光复利进行了部署调研", MORNING, 60, "morning");
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
  const tb = inferTimeBlock("早上醒来6.30-7.30，对拾光复利进行了部署调研", new Date(2026, 8, 20, 7, 17), 60, "morning");
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
