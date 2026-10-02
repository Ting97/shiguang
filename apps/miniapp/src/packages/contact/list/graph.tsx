/**
 * 星型关系图谱 —— canvas 2d 简化版（= web components/contact-graph.tsx + lib/graph.ts buildStarGraph）。
 * 保留：我为中心、五档重要程度同心轨道（亲密最近/简单最远，虚线圈+档位标签）、角度按分组聚拢、
 * 节点半径=亲密度+互动次数、分组配色连线（弧度+热度透明度）、中心光晕、分组图例、点节点进 TA 档案。
 *
 * 【简化范围 · 小程序约束】web 的以下交互未做：节点拖动摆位、滚轮/双指缩放、空白拖拽平移、
 * 双击复位、+/− 按钮、hover 提示浮层、同轨相邻过近的标签翻转防叠（间距由轨道+分片保证）。
 * 布局参数与 web lib/graph.ts 逐值一致，仅渲染端换成 canvas。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Canvas } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useTheme } from "@/lib/theme";
import type { ContactRow } from "../shared";
import { CONTACT_GROUPS, GROUP_COLOR, GROUP_EMOJI, IMPORTANCE_TIERS } from "../shared";

/** 布局节点（= web GraphNode 子集，坐标为画布 CSS px） */
interface GraphNode {
  id: string;
  name: string;
  group: string;
  color: string;
  x: number;
  y: number;
  r: number;
  count: number;
}

interface Layout {
  size: number;
  center: { x: number; y: number; r: number };
  nodes: GraphNode[];
  rings: { r: number; label: string }[];
  legend: { tag: string; color: string; count: number }[];
}

const clampTier = (v?: number): number => {
  const n = Math.round(Number(v));
  return [1, 2, 3, 4, 5].includes(n) ? n : 3;
};

/** 星型布局（= web buildStarGraph；角度分片/轨道半径/节点半径逐值同源） */
function buildLayout(contacts: ContactRow[], size: number): Layout {
  const cx = size / 2;
  const cy = size / 2;
  const n = contacts.length;
  const counts = contacts.map((c) => Number(c.interaction_count) || 0);
  const maxCount = Math.max(1, ...counts);
  const nodeR = (c: ContactRow) => {
    const intimacy = Math.min(100, Math.max(0, Number(c.intimacy) || 0));
    const count = Math.min(10, Number(c.interaction_count) || 0);
    return Math.min(26, 14 + (intimacy / 100) * 12 + count);
  };
  const maxR = n ? Math.max(...contacts.map(nodeR)) : 20;
  const outer = size / 2 - maxR - 44; // 边距含名字标签高度（web 同注释）
  const inner = outer * 0.4;
  const ringGap = (outer - inner) / (IMPORTANCE_TIERS.length - 1);
  const tierRadius = (tier: number) => inner + (5 - tier) * ringGap;

  const normGroup = (tag?: string) => (CONTACT_GROUPS as readonly string[]).includes(tag ?? "") ? (tag as string) : "其他";
  const groupsOrder = CONTACT_GROUPS.filter((g) => contacts.some((c) => normGroup(c.group_tag) === g));
  const shards = groupsOrder.map((g) =>
    contacts
      .filter((c) => normGroup(c.group_tag) === g)
      .sort((a, b) => Number(b.interaction_count || 0) - Number(a.interaction_count || 0) || String(a.name).localeCompare(String(b.name), "zh")),
  );
  const total = n || 1;
  const gapSlots = Math.max(0, shards.length - 1) * 0.5; // 组间空隙占 0.5 个节点位

  const nodes: GraphNode[] = [];
  let slot = 0;
  for (const shard of shards) {
    for (const c of shard) {
      const angle = -Math.PI / 2 + ((slot + gapSlots / 2 + 0.5) / (total + gapSlots)) * Math.PI * 2;
      const orbit = tierRadius(clampTier(c.importance));
      const count = Number(c.interaction_count) || 0;
      const group = normGroup(c.group_tag);
      nodes.push({
        id: c.id,
        name: String(c.name ?? ""),
        group,
        color: GROUP_COLOR[group] ?? GROUP_COLOR.其他,
        x: cx + Math.cos(angle) * orbit,
        y: cy + Math.sin(angle) * orbit,
        r: nodeR(c),
        count,
      });
      slot += 1;
    }
    slot += 0.5;
  }

  return {
    size,
    center: { x: cx, y: cy, r: 30 },
    nodes,
    rings: IMPORTANCE_TIERS.map((t) => ({ r: tierRadius(t.level), label: t.label })).reverse(),
    legend: groupsOrder.map((tag) => ({
      tag,
      color: GROUP_COLOR[tag] ?? GROUP_COLOR.其他,
      count: shards[groupsOrder.indexOf(tag)]?.length ?? 0,
    })),
  };
}

export default function ContactGraph(opts: { contacts: ContactRow[]; onOpen: (id: string) => void }) {
  const { contacts, onOpen } = opts;
  const { theme } = useTheme();
  const [size, setSize] = useState(0); // 画布 CSS px（随容器宽，正方形）
  const rectRef = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    // 量容器宽 → 定画布尺寸（canvas 2d 需先有 CSS 尺寸再取 node）
    Taro.createSelectorQuery()
      .select("#ct-graph-wrap")
      .boundingClientRect((rect: any) => {
        if (rect?.width) setSize(Math.max(320, Math.min(560, rect.width)));
      })
      .exec();
  }, []);

  const layout = useMemo(() => (size ? buildLayout(contacts, size) : null), [contacts, size]);
  const nodesRef = useRef<GraphNode[]>([]);
  nodesRef.current = layout?.nodes ?? [];

  /** 画布重绘（依赖布局/主题；node 获取是异步的，每次依赖变化重新 query 一次） */
  useEffect(() => {
    if (!size || !layout) return;
    Taro.createSelectorQuery()
      .select("#ct-graph")
      .fields({ node: true, size: true, rect: true })
      .exec((res: any) => {
        const info = res?.[0];
        const canvas = info?.node;
        if (!canvas || !info?.width) return;
        const dpr = Taro.getSystemInfoSync().pixelRatio || 2;
        canvas.width = info.width * dpr;
        canvas.height = info.height * dpr;
        rectRef.current = { left: info.left ?? 0, top: info.top ?? 0 };
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        draw(ctx, layout, theme === "light");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, layout, theme]);

  function draw(ctx: any, g: Layout, light: boolean) {
    const orbit = light ? "rgba(15, 23, 42, 0.08)" : "rgba(148, 163, 184, 0.14)"; // = var(--orbit)
    const surface = light ? "#ffffff" : "#0f172a";
    const label = light ? "#334155" : "#cbd5e1"; // = var(--ink-soft)

    ctx.clearRect(0, 0, g.size, g.size);

    // 五档轨道参考圈 + 顶部档位标签（衬底防叠线）
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = orbit;
    ctx.lineWidth = 1;
    for (const ring of g.rings) {
      ctx.beginPath();
      ctx.arc(g.center.x, g.center.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = surface;
      ctx.strokeText(ring.label, g.center.x, g.center.y - ring.r - 4);
      ctx.fillStyle = label;
      ctx.fillText(ring.label, g.center.x, g.center.y - ring.r - 4);
    }
    ctx.setLineDash([]);

    // 中心光晕（径向渐变，= url(#star-glow)）
    const glow = ctx.createRadialGradient(g.center.x, g.center.y, 0, g.center.x, g.center.y, g.center.r + 18);
    glow.addColorStop(0, "rgba(99, 102, 241, 0.45)");
    glow.addColorStop(0.7, "rgba(99, 102, 241, 0.12)");
    glow.addColorStop(1, "rgba(99, 102, 241, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(g.center.x, g.center.y, g.center.r + 18, 0, Math.PI * 2);
    ctx.fill();

    // 中心 → 联系人连线：二次贝塞尔轻度弧度，互动热度→不透明度（= web edges）
    g.nodes.forEach((nd, i) => {
      const mx = (g.center.x + nd.x) / 2;
      const my = (g.center.y + nd.y) / 2;
      const dx = nd.x - g.center.x;
      const dy = nd.y - g.center.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = len * 0.08 * (i % 2 === 0 ? 1 : -1);
      const qx = mx + (-dy / len) * bend;
      const qy = my + (dx / len) * bend;
      const opacity = 0.12 + (nd.count / Math.max(1, ...g.nodes.map((x) => x.count))) * 0.43;
      ctx.strokeStyle = nd.color;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(g.center.x, g.center.y);
      ctx.quadraticCurveTo(qx, qy, nd.x, nd.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // 联系人节点：分组色 tinted 圆 + 同色描边 + 组 emoji + 名字标签（衬底）
    for (const nd of g.nodes) {
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = nd.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = nd.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 组 emoji 居中（web 节点为空心，小程序加 emoji 提升可点性辨识）
      ctx.font = `${Math.round(nd.r)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(GROUP_EMOJI[nd.group] ?? "👤", nd.x, nd.y);
      // 名字标签（描边衬底，= paintOrder:stroke）
      ctx.textBaseline = "alphabetic";
      ctx.font = "13px sans-serif";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = surface;
      const name = nd.name.length > 5 ? `${nd.name.slice(0, 4)}…` : nd.name;
      ctx.strokeText(name, nd.x, nd.y + nd.r + 15);
      ctx.fillStyle = label;
      ctx.fillText(name, nd.x, nd.y + nd.r + 15);
    }

    // 中心「我」（= star-center 径向渐变）
    const cg = ctx.createRadialGradient(g.center.x - 6, g.center.y - 8, 2, g.center.x, g.center.y, g.center.r);
    cg.addColorStop(0, "#38bdf8");
    cg.addColorStop(1, "#6366f1");
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(g.center.x, g.center.y, g.center.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("我", g.center.x, g.center.y + 1);
  }

  /** 点节点进 TA 档案（命中半径 = 节点半径 + 12px 容差） */
  function handleTap(e: any) {
    const touch = e?.changedTouches?.[0];
    if (!touch || !rectRef.current) return;
    const x = touch.clientX - rectRef.current.left;
    const y = touch.clientY - rectRef.current.top;
    let best: { nd: GraphNode; d: number } | null = null;
    for (const nd of nodesRef.current) {
      const d = Math.hypot(nd.x - x, nd.y - y);
      if (d <= nd.r + 12 && (!best || d < best.d)) best = { nd, d };
    }
    if (best) onOpen(best.nd.id);
  }

  return (
    <View>
      <View id="ct-graph-wrap" className="cg-wrap">
        {size > 0 && (
          <Canvas
            type="2d"
            id="ct-graph"
            style={{ width: `${size}px`, height: `${size}px` }}
            onTouchEnd={handleTap}
          />
        )}
      </View>
      {/* 分组图例（= web legend；提示语按简化范围调整） */}
      <View className="cg-legend">
        {(layout?.legend ?? []).map((l) => (
          <View key={l.tag} className="cg-legend-item">
            <View className="cg-legend-dot" style={{ backgroundColor: l.color }} />
            <Text>{l.tag}</Text>
            <Text className="cg-legend-count">{l.count}</Text>
          </View>
        ))}
      </View>
      <Text className="cg-hint">距离=重要程度 · 圈层由内到外为亲密→简单 · 点击节点看 TA 档案</Text>
    </View>
  );
}
