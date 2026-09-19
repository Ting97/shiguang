/**
 * 人际星型图谱布局（Phase 3 W11 + 2026-09-18 五档轨道改造）—— 纯函数，无依赖，可单测
 * 我为中心：角度按分组聚拢（颜色=分组）；距离按重要程度五档分轨（亲密最近、简单最远）；
 * 节点半径=亲密度+互动频率，边透明度=互动频率。被 /contacts 图谱视图消费
 */
import { CONTACT_GROUPS, GROUP_COLOR, IMPORTANCE_TIERS, type ContactGroup } from "./social";

export interface GraphContact {
  id: string;
  name: string;
  group_tag: string;
  intimacy: number;
  /** 重要程度 1~5（5=亲密…1=简单）；缺省按 3（普通） */
  importance?: number | string;
  interaction_count: number | string;
  gift_net_cents?: number | string | null;
  last_summary?: string | null;
  last_at?: string | null;
}

export interface GraphNode {
  id: string;
  name: string;
  group: ContactGroup;
  color: string;
  x: number;
  y: number;
  r: number;
  /** 归一化互动频率 0~1（边透明度/提示用） */
  heat: number;
  intimacy: number;
  count: number;
  /** 重要程度档位 1~5（5=亲密，决定所在轨道） */
  tier: number;
}

export interface StarGraph {
  width: number;
  height: number;
  center: { x: number; y: number; r: number };
  nodes: GraphNode[];
  /** 中心 → 联系人的连线（顺序与 nodes 一致） */
  edges: { x2: number; y2: number; color: string; opacity: number }[];
  /** 图例：实际出现的分组（按固定组序） */
  legend: { tag: ContactGroup; color: string; count: number }[];
  /** 五档轨道参考圈：亲密最近、简单最远 */
  rings: { r: number; label: string }[];
}

const DEFAULT_SIZE = 640;

/**
 * 星型布局：
 * - 距离：重要程度五档五条同心轨道，亲密(5)最近、简单(1)最远；未设置按普通(3)；
 * - 角度：联系人按固定组序排列（同组相邻），组间按组序整体分片并留空隙；
 *   组内按互动次数降序再按姓名，保证同一份联系人数据布局稳定（可快照对比）；
 * - 节点半径 r = 14 + 亲密度贡献(0~12) + 互动次数贡献(0~10)，上限 26（避免跨轨遮挡）；
 * - 中心 (cx,cy)，外圈轨道半径 = 画布短边/2 - 最大节点半径 - 边距。
 */
export function buildStarGraph(contacts: GraphContact[], size: number = DEFAULT_SIZE): StarGraph {
  const cx = size / 2;
  const cy = size / 2;
  const n = contacts.length;

  const counts = contacts.map((c) => Number(c.interaction_count) || 0);
  const maxCount = Math.max(1, ...counts);
  const nodeR = (c: GraphContact) => {
    const intimacy = Math.min(100, Math.max(0, Number(c.intimacy) || 0));
    const count = Math.min(10, Number(c.interaction_count) || 0);
    return Math.min(26, 14 + (intimacy / 100) * 12 + count);
  };
  const maxR = n ? Math.max(...contacts.map(nodeR)) : 20;
  const outer = size / 2 - maxR - 26; // 最外圈（简单档）
  const inner = outer * 0.4; // 最内圈（亲密档）
  const ringGap = (outer - inner) / (IMPORTANCE_TIERS.length - 1);
  /** 重要程度 → 轨道半径：5(亲密)=inner 最近，1(简单)=outer 最远 */
  const tierRadius = (tier: number) => inner + (5 - tier) * ringGap;

  // 分组分片：组序与 CONTACT_GROUPS 一致；组间空隙 = 组隙/组数
  const groupsOrder = CONTACT_GROUPS.filter((g) => contacts.some((c) => normGroup(c.group_tag) === g));
  const shards: GraphContact[][] = groupsOrder.map((g) =>
    contacts
      .filter((c) => normGroup(c.group_tag) === g)
      .sort((a, b) => Number(b.interaction_count) - Number(a.interaction_count) || a.name.localeCompare(b.name, "zh")),
  );
  const total = n || 1;
  const gapSlots = Math.max(0, shards.length - 1) * 0.5; // 每个组间隙占 0.5 个节点位

  const nodes: GraphNode[] = [];
  const edges: StarGraph["edges"] = [];
  let slot = 0;
  for (const shard of shards) {
    for (const c of shard) {
      const angle = -Math.PI / 2 + ((slot + gapSlots / 2 + 0.5) / (total + gapSlots)) * Math.PI * 2;
      const r = nodeR(c);
      const count = Number(c.interaction_count) || 0;
      const group = normGroup(c.group_tag);
      const tier = clampTier(c.importance);
      const orbit = tierRadius(tier);
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit;
      nodes.push({
        id: c.id,
        name: c.name,
        group,
        color: GROUP_COLOR[group] ?? GROUP_COLOR.其他,
        x,
        y,
        r,
        heat: count / maxCount,
        intimacy: Math.min(100, Math.max(0, Number(c.intimacy) || 0)),
        count,
        tier,
      });
      edges.push({
        x2: x,
        y2: y,
        color: GROUP_COLOR[group] ?? GROUP_COLOR.其他,
        // 互动越多边越实：0.12 ~ 0.55
        opacity: 0.12 + (count / maxCount) * 0.43,
      });
      slot += 1;
    }
    slot += 0.5; // 组间空隙
  }

  return {
    width: size,
    height: size,
    center: { x: cx, y: cy, r: 30 },
    nodes,
    edges,
    legend: groupsOrder.map((tag) => ({
      tag,
      color: GROUP_COLOR[tag] ?? GROUP_COLOR.其他,
      count: shards[groupsOrder.indexOf(tag)].length,
    })),
    // 轨道参考圈：从外(简单)到内(亲密)
    rings: IMPORTANCE_TIERS.map((t) => ({ r: tierRadius(t.level), label: t.label })).reverse(),
  };
}

/** 重要程度钳制：1~5 整数，其余按 3（普通） */
function clampTier(v: number | string | undefined): number {
  const n = Math.round(Number(v));
  return [1, 2, 3, 4, 5].includes(n) ? n : 3;
}

function normGroup(tag: string): ContactGroup {
  return (CONTACT_GROUPS as readonly string[]).includes(tag) ? (tag as ContactGroup) : "其他";
}
