import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetTone,
  categoryBreakdown,
  momChange,

  savingsRate,
  yuan,
  yuanToCents,
} from "../src/finance.ts";

test("分类占比：按金额降序且百分比合计 100", () => {
  const slices = categoryBreakdown({ 餐饮: 3000, 交通: 1000, 人情往来: 6000 });
  assert.deepEqual(slices.map((s) => s.category), ["人情往来", "餐饮", "交通"]);
  assert.equal(slices[0].pct, 60);
  const total = slices.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(total - 100) < 1.5, `占比合计应≈100，实际 ${total}`);
});

test("分类占比：零/负金额过滤与空数据处理", () => {
  assert.deepEqual(categoryBreakdown({ 餐饮: 0, 交通: -5 }), []);
  assert.deepEqual(categoryBreakdown({}), []);
});

test("储蓄率：正常/零收入", () => {
  assert.equal(savingsRate(10000, 6000), 40);
  assert.equal(savingsRate(8000, 9000), -12.5);
  assert.equal(savingsRate(0, 100), null);
});

test("预算状态：安全/预警/超支/未设置", () => {
  assert.deepEqual(budgetTone(3000, 10000, 80), { tone: "safe", pct: 30 });
  assert.deepEqual(budgetTone(8500, 10000, 80), { tone: "warn", pct: 85 });
  assert.deepEqual(budgetTone(10500, 10000, 80), { tone: "over", pct: 105 });
  assert.deepEqual(budgetTone(500, 0, 80), { tone: "none", pct: 0 });
});

test("分转元显示：整数不带小数", () => {
  assert.equal(yuan(26000), "260");
  assert.equal(yuan(26050), "260.50");
});

test("环比：正增长/下降/基数为零", () => {
  assert.equal(momChange(11000, 10000), 10);
  assert.equal(momChange(8000, 10000), -20);
  assert.equal(momChange(100, 0), null);
});

test("元转分：常规/三位小数四舍五入/负数/非法入参", () => {
  assert.equal(yuanToCents("12.345"), 1235); // 1.115*100 浮点舍错回归口径：字符串解析精确到分
  assert.equal(yuanToCents("12.3"), 1230);
  assert.equal(yuanToCents("12"), 1200);
  assert.equal(yuanToCents("-5.5"), -550);
  assert.equal(yuanToCents("¥1,234.5"), 123450);
  assert.equal(yuanToCents("abc"), null);
  assert.equal(yuanToCents(""), null);
});

test("元转分上限守卫：超 ¥100 万返回 null（旧版 |0 在 ≥¥21,474,836.48 时 int32 回卷成错值）", () => {
  assert.equal(yuanToCents("1000000"), 100_000_000); // 恰在上限内（=CAP，不拒）
  assert.equal(yuanToCents("1000000.01"), null); // 超 ¥100 万
  assert.equal(yuanToCents("21474836.48"), null); // 旧版 |0 回卷成 -2147483648
  assert.equal(yuanToCents("99999999999"), null);
  assert.equal(yuanToCents("-99999999.99"), null); // 负向同上限（按绝对值判）
});
