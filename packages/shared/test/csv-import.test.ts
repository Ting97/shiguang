import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  dedupeKey,
  detectPlatform,
  parseAmount,
  parseBill,
  parseCstTime,
  splitCsvLines,
} from "../src/csv-import.ts";

/** 支付宝样例：GBK 常见格式（头两行说明 + 表头 + 数据），含引号内逗号 */
const ALIPAY_CSV = `支付宝交易记录明细查询
账号:xxx@163.com    起始日期:2026-09-01    终止日期:2026-09-18
--------------------------------- TRANSACTION RECORDS ------------------------------
交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收付款方式,交易状态,交易订单号,商家订单号,备注
2026-09-01 12:30:00,餐饮美食,老王餐馆,,"午餐（红烧肉套餐，加饭）",支出,"1,280.00",余额,交易成功,2026090122001400001,,
2026-09-02 08:10:00,交通出行,滴滴出行,,快车-通勤,支出,25.50,余额宝,交易成功,2026090222001400002,,
2026-09-03 20:00:00,红包,妈妈,,节日红包,收入,888.00,余额,交易成功,2026090322001400003,,
2026-09-05 10:00:00,日用百货,京东,,洗衣液等日用品,支出,89.00,招商银行卡,交易成功,2026090522001400004,,
2026-09-06 09:00:00,转账,张三,,借出,支出,5000.00,余额,交易成功,2026090622001400005,,
2026-09-07 15:00:00,文化休闲,腾讯视频,,会员充值,支出,30.00,余额,退款成功,2026090722001400006,,
2026-09-08 15:00:00,,余额宝-自动转入,,收益发放,不计收支,0.35,余额,交易成功,2026090822001400007,,
`;

/** 微信样例：UTF-8 常见格式（含 ¥ 前缀与空收支列） */
const WECHAT_CSV = `微信支付账单明细,,,,,,,,,,,
----------------------微信支付账单明细------------------------
,,,,,,,,,,,
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-09-10 18:05:33,商户消费,美团-外卖,鱼香肉丝盖饭,支出,¥26.80,零钱,支付成功,1000120260910180001,M20260910,,/
2026-09-11 09:15:00,微信红包,,收到红包,收入,¥66.66,零钱,已存入零钱,1000120260911090002,,,/
2026-09-12 12:00:00,商户消费,地铁乘车码,出行,/,¥4.00,零钱,支付成功,1000120260912120003,,,/
`;

test("平台检测：支付宝/微信/未知", () => {
  assert.equal(detectPlatform(ALIPAY_CSV), "alipay");
  assert.equal(detectPlatform(WECHAT_CSV), "wechat");
  assert.equal(detectPlatform("id,amount\n1,2"), null);
});

test("金额解析：千分位/¥前缀/空值", () => {
  assert.equal(parseAmount("1,280.00"), 128000);
  assert.equal(parseAmount("¥25.00"), 2500);
  assert.equal(parseAmount("0.35"), 35);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
});

test("北京时间 → UTC ISO", () => {
  assert.equal(parseCstTime("2026-09-01 12:30:00"), "2026-09-01T04:30:00.000Z");
  assert.equal(parseCstTime("2026-09-01 12:30"), "2026-09-01T04:30:00.000Z");
  assert.equal(parseCstTime("2026/09/01"), null);
});

test("CSV 容错解析：引号内逗号", () => {
  const rows = splitCsvLines('a,b,c\n"x, y",2,"多\n行"');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", "2", "多\n行"]]);
});

test("支付宝解析：跳过退款/不计收支，分类与商家正确", () => {
  const { platform, rows, skips } = parseBill(ALIPAY_CSV);
  assert.equal(platform, "alipay");
  // 7 行数据：退款 1 行、不计收支 1 行跳过 → 5 行
  assert.equal(rows.length, 5);
  assert.equal(skips.length, 2);

  const lunch = rows[0];
  assert.equal(lunch.amountCents, 128000);
  assert.equal(lunch.direction, "out");
  assert.equal(lunch.category, "餐饮");
  assert.equal(lunch.counterparty, "老王餐馆");
  assert.equal(lunch.externalNo, "2026090122001400001");
  assert.equal(lunch.occurredAt, "2026-09-01T04:30:00.000Z");
  assert.ok(lunch.note!.includes("红烧肉套餐")); // 引号内逗号不断行

  assert.equal(rows[1].category, "交通"); // 滴滴 → 交通（交易分类「交通出行」映射）
  assert.equal(rows[2].category, "人情往来"); // 红包 → 人情往来
  assert.equal(rows[2].direction, "in");
  assert.equal(rows[3].category, "购物"); // 京东 → 购物
  assert.equal(rows[4].category, "人情往来"); // 转账张三 → 人情往来（关键词优先于未映射分类）
});

test("微信解析：¥ 金额、红包收入、地铁兜底分类", () => {
  const { platform, rows, skips } = parseBill(WECHAT_CSV);
  assert.equal(platform, "wechat");
  assert.equal(rows.length, 2); // 「/」不计收支跳过
  assert.equal(skips.length, 1);

  assert.equal(rows[0].amountCents, 2680);
  assert.equal(rows[0].category, "餐饮"); // 美团-外卖 → 餐饮
  assert.equal(rows[0].externalNo, "1000120260910180001");
  assert.equal(rows[1].direction, "in");
  assert.equal(rows[1].category, "人情往来"); // 红包
  assert.equal(skips[0].reason.includes("不计收支"), true);
});

test("无法识别平台时抛中文错误", () => {
  assert.throws(() => parseBill("a,b\n1,2"), /无法识别账单类型/);
});

test("分类：平台分类列优先、关键词兜底、默认其他", () => {
  assert.equal(classify("餐饮美食", "任意", ""), "餐饮");
  assert.equal(classify("", "肯德基", "宅急送"), "餐饮");
  assert.equal(classify("", "某书店", "图书"), "学习");
  assert.equal(classify("", "某某咨询公司", "服务费"), "其他");
});

test("去重键：单号优先，无单号用指纹", () => {
  const base = {
    direction: "out" as const,
    amountCents: 1000,
    category: "其他",
    counterparty: "甲",
    note: null,
    occurredAt: "2026-09-01T04:00:00.000Z",
    externalNo: null,
    rawTime: "2026-09-01 12:00:00",
  };
  assert.equal(
    dedupeKey({ ...base, externalNo: "NO1" }),
    "no:NO1",
  );
  assert.equal(
    dedupeKey({ ...base, externalNo: null }),
    "fp:2026-09-01T04:00:00.000Z|1000|甲|out",
  );
});
