"use client";

import { TagChip } from "@/components/tag-chip";
import { PARTITION_META, type CatalogPayload } from "./types";

/**
 * ===== 数据面 · 区块 2：数据目录（REQ-005 FR-5.3）=====
 * 表格：key / 名称 / 描述 / 分区徽标（类别型=中性、行为型=蓝、AI 衍生=紫）/ 时间列 / promptRefs 文本徽标。
 */
export default function CatalogTable({ catalog }: { catalog: CatalogPayload }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line-soft">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line-soft bg-elevated/60 text-[10px] tracking-wide text-ink-faint">
              <th className="px-2.5 py-1.5 font-medium">key</th>
              <th className="px-2.5 py-1.5 font-medium">名称</th>
              <th className="px-2.5 py-1.5 font-medium">描述</th>
              <th className="px-2.5 py-1.5 font-medium">分区</th>
              <th className="px-2.5 py-1.5 font-medium">时间列</th>
              <th className="px-2.5 py-1.5 font-medium">关联 prompt</th>
            </tr>
          </thead>
          <tbody>
            {catalog.datasets.map((d) => (
              <tr key={d.key} className="border-b border-line-soft/50 align-top last:border-0">
                <td className="px-2.5 py-1.5 font-mono text-[10px] text-accent">{d.key}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-ink">{d.name}</td>
                <td className="px-2.5 py-1.5 text-[11px] text-ink-dim">{d.desc}</td>
                <td className="px-2.5 py-1.5">
                  <TagChip label={PARTITION_META[d.partition].label} tone={PARTITION_META[d.partition].tone} size="sm" />
                </td>
                <td className="px-2.5 py-1.5 font-mono text-[10px] text-ink-mute">{d.timeCol ?? "—"}</td>
                <td className="px-2.5 py-1.5">
                  <div className="flex max-w-52 flex-wrap gap-1">
                    {d.promptRefs.length ? (
                      d.promptRefs.map((p) => <TagChip key={p} label={p} tone="sky" size="sm" title="引用该数据集的 prompt key" />)
                    ) : (
                      <span className="text-[10px] text-ink-faint">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-ink-faint">{catalog._meta.note}</p>
    </div>
  );
}
