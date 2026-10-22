import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, parseAmountCents } from "../src/duration.js";

test("显式时长：数字+分钟", () => {
  assert.equal(parseDuration("刚跑完步，练了40分钟"), 40);
  assert.equal(parseDuration("花了50分钟"), 50);
});

test("显式时长：中文数字+小时", () => {
  assert.equal(parseDuration("聊了两个小时"), 120);
  assert.equal(parseDuration("三个小时的电影"), 180);
  assert.equal(parseDuration("撸铁一小时"), 60);
});

test("显式时长：口语变体", () => {
  assert.equal(parseDuration("一个半小时"), 90);
  assert.equal(parseDuration("俩小时"), 120);
  assert.equal(parseDuration("半小时"), 30);
  // 惯用语分支命中（240 分钟）——旧断言 `=== null || true` 恒真且注释与实现相反（十四轮修正）
  assert.equal(parseDuration("弄了一下午"), 240);
});

test("中文数字含「十」的回归（十点/四十分钟/十点半）", () => {
  assert.equal(parseDuration("跑了四十分钟"), 40);
  assert.equal(parseDuration("十分钟的拉伸"), 10);
  assert.equal(parseDuration("五十分钟"), 50);
});

test("无时长返回 null", () => {
  assert.equal(parseDuration("晚上刷了会儿抖音"), null);
  assert.equal(parseDuration("中午和老王吃饭"), null);
});

test("金额解析（分）", () => {
  assert.equal(parseAmountCents("花了260"), 26000);
  assert.equal(parseAmountCents("随了600块礼"), 60000);
  assert.equal(parseAmountCents("980.5元"), 98050);
  assert.equal(parseAmountCents("看书一小时"), null);
});

// —— 009 轮检视回归：显式时长 <0.5 分钟取整为 0 曾撞 durationMin>0 契约（rules 路径 zod 异常逃逸） ——
test("显式时长：亚分钟向上保底 1 分钟（打卡入口不可失败）", () => {
  assert.equal(parseDuration("刷了0.4分钟手机"), 1);
  assert.equal(parseDuration("0.5分钟"), 1);
  assert.equal(parseDuration("半小时"), 30); // 惯用语分支不受影响
  assert.equal(parseDuration("一个半小时"), 90);
});

// —— 检视回归：带单位口语尾数（「9块9」旧版只匹配「9块」漏掉尾数，少算 90 分） ——
test("金额口语尾数：「9块9」「35块5」「12元5」并入为 X.9 元", () => {
  assert.equal(parseAmountCents("花了9块9"), 990);
  assert.equal(parseAmountCents("35块5"), 3550);
  assert.equal(parseAmountCents("12元5"), 1250);
  assert.equal(parseAmountCents("花了9块99"), 999); // 两位尾数同型（=9.99 元）
});

test("金额尾数形态：「9块9角」=990 分（角=0.1 元，同型并入即正确值）；3 位以上数字不并", () => {
  assert.equal(parseAmountCents("花了9块9角"), 990);
  // 3 位以上是另一段数字（量词/编号，如「12元5000步」）不并——宁少勿错
  assert.equal(parseAmountCents("12元5000"), 1200);
  // 无尾数回归不受影响
  assert.equal(parseAmountCents("随了600块礼"), 60000);
  assert.equal(parseAmountCents("花了3千块"), 300_000);
});

// —— 十四轮回归：中文数字金额接入（「花了两万」旧版解析不出，金额静默丢失） ——
test("金额中文数字：两万/三千五/二十五万/两百，约数并列取保守上界", () => {
  assert.equal(parseAmountCents("花了两万"), 2_000_000);
  assert.equal(parseAmountCents("随了三千五"), 350_000); // 3500 元
  assert.equal(parseAmountCents("花了三千五百块"), 350_000); // 3500 元
  assert.equal(parseAmountCents("交了二十五万元"), 25_000_000); // 25 万元
  assert.equal(parseAmountCents("随了两百"), 20_000);
  assert.equal(parseAmountCents("花了两三万"), 3_000_000); // 约数并列 → 末位 3 上界（3 万元）
});

// —— 十四轮回归："1.5k" 口语=1500 而非 1.5 元——不支持 k 后缀就整体放弃（宁 null 勿千倍错） ——
test("金额 kK 后缀守卫：不误读千倍缩水", () => {
  assert.equal(parseAmountCents("花了1.5k"), null);
  assert.equal(parseAmountCents("花了260"), 26000); // 回归不破
});
