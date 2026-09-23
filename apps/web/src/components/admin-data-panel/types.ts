/** /admin · 数据面模块共享类型（admin-data-panel.tsx 与 admin-data-panel/ 子组件共用，REQ-005 FR-5.x） */

export type DatasetPartition = "category" | "behavior" | "derived";

export interface DatasetSpec {
  key: string;
  name: string;
  desc: string;
  partition: DatasetPartition;
  timeCol: string | null;
  categoryCol?: string;
  columns: string[];
  promptRefs: string[];
}

export interface CatalogPayload {
  datasets: DatasetSpec[];
  _meta: { note: string };
}

export interface CategoryGroup {
  domain: string;
  name: string;
  items: { source: string; values: string[] };
}

export interface TrialResult {
  total: number;
  items: Record<string, unknown>[];
}

/** 分区 → 徽标语义色（类别型=中性 / 行为型=蓝 / AI 衍生=紫），目录表与个性化注入 chips 共用 */
export const PARTITION_META: Record<DatasetPartition, { label: string; tone: "slate" | "sky" | "violet" }> = {
  category: { label: "类别型", tone: "slate" },
  behavior: { label: "行为型", tone: "sky" },
  derived: { label: "AI 衍生", tone: "violet" },
};
