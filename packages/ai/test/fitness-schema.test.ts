/**
 * 健身计划解析契约测试（REQ-016）：FitnessPlanDraftV2 判定/越界/映射为整数口径。
 * 纯包测试：不依赖 DB 与网络。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FitnessPlanDraftV2 } from "../src/schema";

test("FitnessPlanDraftV2：跑步金标准通过", () => {
  const parsed = FitnessPlanDraftV2.safeParse({
    reasoning: "典型佳明间歇课表",
    module: "run",
    run: {
      workoutType: "interval",
      title: "间歇跑 8 公里",
      segments: [
        { label: "热身", distanceKm: 1, paceText: "6:15" },
        { label: "6×400 米", distanceKm: 0.4, reps: 6, paceText: "5'20\"" },
      ],
      totalDistanceKm: 8,
      durationMin: 55,
    },
    confidence: 0.95,
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.run?.segments.length, 2);
});

test("FitnessPlanDraftV2：力量金标准通过 + 句子片段动作名拒绝", () => {
  const ok = FitnessPlanDraftV2.safeParse({
    module: "strength",
    strength: {
      title: "力量课 B · 拉为主",
      exercises: [{ name: "坐姿划船", sets: 3, repsText: "10-12" }],
    },
    confidence: 0.9,
  });
  assert.ok(ok.success);

  const bad = FitnessPlanDraftV2.safeParse({
    module: "strength",
    strength: {
      title: "废课",
      exercises: [{ name: "然后做三组划船" }],
    },
    confidence: 0.9,
  });
  assert.ok(!bad.success, "句子片段动作名应拒绝");
});

test("FitnessPlanDraftV2：module 与内容组不匹配拒绝", () => {
  const noRun = FitnessPlanDraftV2.safeParse({ module: "run", strength: { title: "x", exercises: [{ name: "卧推" }] }, confidence: 0.9 });
  assert.ok(!noRun.success, "module=run 缺 run 内容应拒绝");
  const noStrength = FitnessPlanDraftV2.safeParse({ module: "strength", run: undefined, confidence: 0.9 });
  assert.ok(!noStrength.success, "module=strength 缺 strength 内容应拒绝");
});

test("FitnessPlanDraftV2：单位越界拒绝（距离>300km / 重量>500kg）", () => {
  const far = FitnessPlanDraftV2.safeParse({
    module: "run",
    run: { workoutType: "easy", title: "超远", totalDistanceKm: 500 },
    confidence: 0.9,
  });
  assert.ok(!far.success);
  const heavy = FitnessPlanDraftV2.safeParse({
    module: "strength",
    strength: { title: "超重", exercises: [{ name: "硬拉", weightKg: 900 }] },
    confidence: 0.9,
  });
  assert.ok(!heavy.success);
});
