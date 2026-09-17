import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetTone,
  categoryBreakdown,
  momChange,
  monthKey,
  prevMonthKey,
  savingsRate,
  yuan,
} from "../src/lib/finance.ts";

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

test("月份工具：当月与上月（跨年边界）", () => {
  assert.equal(monthKey(new Date(2026, 8, 17)), "2026-09");
  assert.equal(prevMonthKey("2026-09"), "2026-08");
  assert.equal(prevMonthKey("2026-01"), "2025-12");
});

test("环比：正增长/下降/基数为零", () => {
  assert.equal(momChange(11000, 10000), 10);
  assert.equal(momChange(8000, 10000), -20);
  assert.equal(momChange(100, 0), null);
});
