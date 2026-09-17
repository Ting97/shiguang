/**
 * 人际星型图谱布局（Phase 3 W11）—— 纯函数，无依赖，可单测
 * 我为中心，联系人按分组聚拢成一圈：颜色=分组，半径=亲密度+互动频率，边透明度=互动频率
 * 被 /contacts 图谱视图消费；数据来自 GET /api/contacts
 */
import { CONTACT_GROUPS, GROUP_COLOR, type ContactGroup } from "./social";

export interface GraphContact {
  id: string;
  name: string;
  group_tag: string;
  intimacy: number;
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
}

const DEFAULT_SIZE = 640;

/**
 * 星型布局：
 * - 联系人按固定组序排列（同组相邻），组间按组序整体分片并留空隙；
 * - 组内按互动次数降序再按姓名，保证同一份联系人数据布局稳定（可快照对比）；
 * - 节点半径 r = 14 + 亲密度贡献(0~12) + 互动次数贡献(0~10)，上限 36；
 * - 中心 (cx,cy)，联系人分布半径 = 画布短边/2 - 最大节点半径 - 边距。
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
    return Math.min(36, 14 + (intimacy / 100) * 12 + count);
  };
  const maxR = n ? Math.max(...contacts.map(nodeR)) : 20;
  const orbit = size / 2 - maxR - 26; // 留出节点自身与画布边距

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
  };
}

function normGroup(tag: string): ContactGroup {
  return (CONTACT_GROUPS as readonly string[]).includes(tag) ? (tag as ContactGroup) : "其他";
}
