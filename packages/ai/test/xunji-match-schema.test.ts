/**
 * 训记动作名匹配契约测试（REQ-022）：XunjiNameMatchResult 正反例。
 * 纯包测试：不依赖 DB 与网络。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { XunjiNameMatchResult } from "../src/schema";

test("XunjiNameMatchResult：金标准通过（null=无匹配，字段保真）", () => {
  const parsed = XunjiNameMatchResult.safeParse({
    matches: [
      { source: "坐姿绳索划船", official: "坐姿划船", confidence: 0.9 },
      { source: "神秘动作", official: null, confidence: 0.2 },
    ],
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.matches.length, 2);
  assert.equal(parsed.data.matches[1].official, null);
});

test("XunjiNameMatchResult：空 matches 拒绝（须逐条回执）；超 15 条拒绝", () => {
  assert.ok(!XunjiNameMatchResult.safeParse({ matches: [] }).success, "空回执无意义——编排按输入名单校验");
  const tooMany = {
    matches: Array.from({ length: 16 }, (_, i) => ({ source: `动作${i}`, official: null, confidence: 0.1 })),
  };
  assert.ok(!XunjiNameMatchResult.safeParse(tooMany).success);
});

test("XunjiNameMatchResult：confidence 越界宽容收缩为 0.5（低于编排阈值视为未匹配）；official 空串/超长拒绝", () => {
  const loose = XunjiNameMatchResult.safeParse({
    matches: [{ source: "卧推", official: "杠铃卧推", confidence: 1.5 }],
  });
  assert.ok(loose.success, "confidence 与其它 AI 契约同款宽容口径");
  assert.equal(loose.data.matches[0].confidence, 0.5, "越界 catch 成 0.5——低于编排 0.6 门槛，安全");
  assert.ok(
    !XunjiNameMatchResult.safeParse({
      matches: [{ source: "卧推", official: "", confidence: 0.9 }],
    }).success,
    "空串官方名无效（要么 null 要么非空）",
  );
  assert.ok(
    !XunjiNameMatchResult.safeParse({
      matches: [{ source: "卧推", official: "超".repeat(31), confidence: 0.9 }],
    }).success,
    "官方名 30 字上限",
  );
});
