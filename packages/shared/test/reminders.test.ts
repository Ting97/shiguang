import { test } from "node:test";
import assert from "node:assert/strict";
import { pickReminders, type ReminderContact, type ReminderTodo } from "../src/reminders.ts";
import { displaySummary } from "../src/social.ts";

// 固定「今天」：2026-09-18 10:00 本地时间，避免用例随日期漂移
const NOW = new Date(2026, 8, 18, 10, 0, 0);

const contact = (over: Partial<ReminderContact>): ReminderContact => ({
  id: "c1",
  name: "老王",
  birthday: null,
  anniversary: null,
  ...over,
});
const todo = (over: Partial<ReminderTodo>): ReminderTodo => ({
  id: "t1",
  title: "看牙",
  due_at: null,
  remind_at: null,
  ...over,
});

test("生日：今天/明天/N 天后/窗口外", () => {
  const items = pickReminders(
    [
      contact({ id: "a", name: "阿一", birthday: "1990-09-18" }), // 今天
      contact({ id: "b", name: "阿二", birthday: "1990-09-19" }), // 明天
      contact({ id: "c", name: "阿三", birthday: "1990-09-23" }), // 5 天后（窗口内）
      contact({ id: "d", name: "阿四", birthday: "1990-09-26" }), // 8 天后（窗口外 7 天）
      contact({ id: "e", name: "阿五", birthday: "1990-03-01" }), // 已过，滚到明年
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    items.map((i) => i.label),
    [
      "今天是 阿一 的生日，记得送上祝福 🎂",
      "阿二 的生日 明天，提前准备一下？",
      "阿三 的生日 5 天后，提前准备一下？",
    ],
  );
});

test("生日：跨年窗口（12 月底看 1 月初的生日）", () => {
  // 12月28日视角，1月2日生日 → 滚到明年后 5 天，窗口内
  const items = pickReminders([contact({ name: "老王", birthday: "1990-01-02" })], [], new Date(2025, 11, 28, 9));
  assert.equal(items.length, 1);
  assert.match(items[0].label, /5 天后/);
});

test("纪念日：与生日同逻辑，可同时提醒", () => {
  const items = pickReminders(
    [contact({ name: "老王", birthday: "1990-09-18", anniversary: "2015-09-19" })],
    [],
    NOW,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "birthday");
  assert.equal(items[1].kind, "anniversary");
  assert.match(items[1].label, /明天/);
});

test("到期待办：过期标红排序最前（remind_at 过滤在 SQL，纯函数收已到提醒时间的待办）", () => {
  const overdue = todo({
    id: "t1",
    title: "交房租",
    due_at: new Date(2026, 8, 18, 8, 0).toISOString(), // 今天 08:00 已过
    remind_at: new Date(2026, 8, 18, 7, 45).toISOString(),
  });
  const future = todo({
    id: "t2",
    title: "看牙",
    due_at: new Date(2026, 8, 18, 15, 0).toISOString(), // 15:00 未到但提醒已发（due-15min 在 09:17 之前?）
    remind_at: new Date(2026, 8, 18, 9, 0).toISOString(), // remind_at <= NOW
  });
  const notYet = todo({
    id: "t3",
    title: "明天的事",
    due_at: new Date(2026, 8, 19, 10, 0).toISOString(),
    remind_at: new Date(2026, 8, 19, 9, 45).toISOString(), // 明天才提醒
  });
  // 契约：remind_at <= now 的过滤在 SQL（/api/reminders）完成，纯函数只收已到提醒时间的待办
  const items = pickReminders([], [overdue, future, notYet], NOW);
  assert.equal(items.length, 3);
  assert.equal(items[0].overdue, true); // 过期排最前
  assert.match(items[0].label, /todo 已过期：交房租（08:00）/);
  assert.equal(items[1].overdue, false);
  assert.match(items[1].label, /todo 即将到期：看牙（15:00）/);
});

test("排序：已过期待办 < 今天的生日 < N 天后", () => {
  const items = pickReminders(
    [contact({ name: "阿香", birthday: "1990-09-18" }), contact({ name: "老王", birthday: "1990-09-20" })],
    [todo({ title: "交房租", due_at: new Date(2026, 8, 18, 8).toISOString(), remind_at: new Date(2026, 8, 18, 7).toISOString() })],
    NOW,
  );
  assert.deepEqual(
    items.map((i) => i.sort),
    [-1, 0, 2],
  );
  assert.equal(items[1].kind, "birthday");
});

test("空数据与无效日期防御", () => {
  assert.deepEqual(pickReminders([], [], NOW), []);
  // 无效生日：跳过；无效 due_at 的待办：仍提醒但不带时间（不产生 NaN）
  const items = pickReminders([contact({ birthday: "乱写的" })], [todo({ due_at: "不是日期", remind_at: new Date(2026, 8, 18, 9).toISOString() })], NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "todo 即将到期：看牙");
});

test("displaySummary：兼容旧数据「X：X」重复拼接", () => {
  assert.equal(displaySummary("吃饭：吃饭"), "吃饭");
  assert.equal(displaySummary("和老王吃饭：吃饭"), "和老王吃饭：吃饭"); // 前后不同不折叠
  assert.equal(displaySummary("打电话"), "打电话"); // 无冒号原样
  assert.equal(displaySummary(null), "");
  assert.equal(displaySummary(""), "");
});
