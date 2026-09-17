import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStarGraph, type GraphContact } from "../src/lib/graph.ts";

const c = (
  id: string,
  name: string,
  group_tag: string,
  intimacy = 50,
  interaction_count = 1,
): GraphContact => ({ id, name, group_tag, intimacy, interaction_count });

test("星型图谱：中心居中，节点分布在圆环上", () => {
  const g = buildStarGraph([c("1", "老王", "朋友"), c("2", "张总", "客户"), c("3", "老妈", "家人")], 600);
  assert.equal(g.center.x, 300);
  assert.equal(g.center.y, 300);
  assert.equal(g.nodes.length, 3);
  for (const nd of g.nodes) {
    const dist = Math.hypot(nd.x - g.center.x, nd.y - g.center.y);
    assert.ok(Math.abs(dist - (300 - nd.r - 26)) < 1e-6, `节点应在轨道半径上: ${dist}`);
  }
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
  assert.ok(high.r <= 36, "半径上限 36");
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
  assert.equal(g.center.x, 300);
});

test("星型图谱：布局确定性 —— 同输入同输出", () => {
  const input = [c("1", "老王", "朋友", 60, 3), c("2", "张总", "客户", 40, 1), c("3", "同事小李", "同事", 50, 2)];
  const a = buildStarGraph(input, 600);
  const b = buildStarGraph([...input].reverse(), 600);
  assert.deepEqual(
    a.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)]),
    b.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)]),
  );
});
