import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStarGraph, type GraphContact } from "../src/graph.ts";

const c = (
  id: string,
  name: string,
  group_tag: string,
  intimacy = 50,
  interaction_count = 1,
  importance?: number,
): GraphContact => ({ id, name, group_tag, intimacy, interaction_count, importance });

const dist = (nd: { x: number; y: number }, center: { x: number; y: number }) =>
  Math.hypot(nd.x - center.x, nd.y - center.y);

test("星型图谱：中心居中，节点按重要程度落在五档轨道上", () => {
  const g = buildStarGraph([c("1", "老王", "朋友", 50, 1, 3), c("2", "张总", "客户", 50, 1, 3), c("3", "老妈", "家人", 50, 1, 3)], 600);
  assert.equal(g.center.x, 300);
  assert.equal(g.center.y, 300);
  assert.equal(g.nodes.length, 3);
  // 默认档位 3（普通）：都在同一中轨上
  const ring3 = g.rings.find((r) => r.label === "普通")!;
  for (const nd of g.nodes) {
    assert.equal(nd.tier, 3, "未设置 importance 默认普通档");
    assert.ok(Math.abs(dist(nd, g.center) - ring3.r) < 1e-6, `普通档节点应在普通轨道上: ${dist(nd, g.center)} vs ${ring3.r}`);
  }
});

test("星型图谱：五档轨道 —— 亲密最近、简单最远，参考圈齐全", () => {
  const g = buildStarGraph([
    c("1", "挚友", "朋友", 50, 1, 5),
    c("2", "重要客户", "客户", 50, 1, 4),
    c("3", "普通同事", "同事", 50, 1, 3),
    c("4", "一般熟人", "其他", 50, 1, 2),
    c("5", "点头之交", "同学", 50, 1, 1),
  ], 600);
  assert.equal(g.rings.length, 5);
  assert.deepEqual(g.rings.map((r) => r.label), ["简单", "一般", "普通", "重要", "亲密"]);
  // 半径严格递减：简单 > 一般 > 普通 > 重要 > 亲密
  const rs = g.rings.map((r) => r.r);
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i] < rs[i - 1], "轨道半径应从外到内递减");
  // 每个节点到自己档位轨道的距离
  for (const nd of g.nodes) {
    const ring = g.rings.find((r2) => r2.label === ({ 5: "亲密", 4: "重要", 3: "普通", 2: "一般", 1: "简单" } as Record<number, string>)[nd.tier])!;
    assert.ok(Math.abs(dist(nd, g.center) - ring.r) < 1e-6, `${nd.name} 应在${ring.label}轨道`);
  }
  // 亲密节点一定比简单节点更靠近中心
  const close = dist(g.nodes.find((n) => n.name === "挚友")!, g.center);
  const far = dist(g.nodes.find((n) => n.name === "点头之交")!, g.center);
  assert.ok(close < far, "亲密档应比简单档更靠近中心");
});

test("星型图谱：非法档位回落普通（3）", () => {
  const g = buildStarGraph([c("1", "老王", "朋友", 50, 1, 99 as number), c("2", "小李", "同事", 50, 1, 0)], 600);
  for (const nd of g.nodes) assert.equal(nd.tier, 3);
});

test("星型图谱：同组相邻、按固定组序分片", () => {
  const g = buildStarGraph([
    c("a", "张总", "客户"),
    c("b", "老王", "朋友"),
    c("c", "老妈", "家人"),
    c("d", "老爸", "家人"),
  ], 600);
  // 角度顺序应按 家人→朋友→客户（CONTACT_GROUPS 序），同组相邻
  const angleOf = (id: string) => {
    const nd = g.nodes.find((x) => x.id === id)!;
    return Math.atan2(nd.y - g.center.y, nd.x - g.center.x);
  };
  const familyGap = Math.abs(angleOf("c") - angleOf("d"));
  const crossGap = Math.abs(angleOf("b") - angleOf("c"));
  assert.ok(familyGap < crossGap, "同组节点角度差应小于跨组");
});

test("星型图谱：节点半径随亲密度/互动次数增大，有上限", () => {
  const low = buildStarGraph([c("1", "路人", "其他", 0, 0)], 600).nodes[0];
  const high = buildStarGraph([c("2", "密友", "朋友", 100, 99)], 600).nodes[0];
  assert.ok(low.r >= 14, "最小半径 14");
  assert.equal(low.r, 14);
  assert.ok(high.r > low.r);
  assert.ok(high.r <= 26, "半径上限 26（防跨轨遮挡）");
});

test("星型图谱：互动越多边越实（透明度更高）", () => {
  const g = buildStarGraph([c("1", "常联", "朋友", 50, 20), c("2", "陌生", "朋友", 50, 0)], 600);
  const hot = g.edges[g.nodes.findIndex((n) => n.name === "常联")].opacity;
  const cold = g.edges[g.nodes.findIndex((n) => n.name === "陌生")].opacity;
  assert.ok(hot > cold);
  assert.ok(cold >= 0.12 && hot <= 0.55);
});

test("星型图谱：分组颜色与图例", () => {
  const g = buildStarGraph([c("1", "老妈", "家人"), c("2", "神秘人", "未知组")], 600);
  const mom = g.nodes.find((n) => n.name === "老妈")!;
  const ghost = g.nodes.find((n) => n.name === "神秘人")!;
  assert.equal(mom.color, "#f43f5e");
  assert.equal(ghost.group, "其他", "未知分组归「其他」");
  assert.deepEqual(g.legend.map((l) => l.tag), ["家人", "其他"]);
  assert.deepEqual(g.legend.map((l) => l.count), [1, 1]);
});

test("星型图谱：空联系人返回空图不抛错", () => {
  const g = buildStarGraph([], 600);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
  assert.equal(g.legend.length, 0);
  assert.equal(g.rings.length, 5, "轨道参考圈始终存在");
  assert.equal(g.center.x, 300);
});

test("星型图谱：布局确定性 —— 同输入同输出", () => {
  const input = [c("1", "老王", "朋友", 60, 3, 4), c("2", "张总", "客户", 40, 1, 2), c("3", "同事小李", "同事", 50, 2, 3)];
  const a = buildStarGraph(input, 600);
  const b = buildStarGraph([...input].reverse(), 600);
  assert.deepEqual(
    a.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)]),
    b.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)]),
  );
});
