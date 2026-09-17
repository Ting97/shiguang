"use client";

/**
 * 星型关系图谱（Phase 3 W11）—— 手写 SVG 渲染，布局在 lib/graph.ts（纯函数+单测）
 * 我为中心；颜色=分组，节点大小=亲密度+互动频率，边实线程度=互动频率；点节点进 TA 档案
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildStarGraph, type GraphContact } from "@/lib/graph";

export default function ContactGraph({
  contacts,
  onOpen,
}: {
  contacts: GraphContact[];
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(640);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(320, Math.min(560, el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => buildStarGraph(contacts, size), [contacts, size]);
  const hovered = hover ? g.nodes.find((n) => n.id === hover) : null;

  return (
    <div>
      <div ref={wrapRef} className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
          <defs>
            <radialGradient id="star-center" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </radialGradient>
          </defs>

          {/* 轨道参考圈 */}
          <circle
            cx={g.center.x}
            cy={g.center.y}
            r={g.nodes.length ? Math.hypot(g.nodes[0].x - g.center.x, g.nodes[0].y - g.center.y) : 0}
            fill="none"
            stroke="rgba(148,163,184,0.12)"
            strokeDasharray="3 6"
          />

          {/* 中心 → 联系人 连线 */}
          {g.edges.map((e, i) => (
            <line
              key={g.nodes[i].id}
              x1={g.center.x}
              y1={g.center.y}
              x2={e.x2}
              y2={e.y2}
              stroke={e.color}
              strokeWidth={1.5}
              opacity={e.opacity}
            />
          ))}

          {/* 联系人节点（先画节点后画文字，保证文字在上） */}
          {g.nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className="cursor-pointer"
              onClick={() => onOpen(n.id)}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
            >
              <circle
                r={n.r}
                fill={n.color}
                fillOpacity={hover === n.id ? 0.5 : 0.28}
                stroke={n.color}
                strokeWidth={hover === n.id ? 2.5 : 1.5}
                className="transition-all duration-150"
              />
              <text
                y={n.r + 15}
                textAnchor="middle"
                className="pointer-events-none select-none fill-slate-300"
                fontSize={13}
              >
                {n.name.length > 5 ? `${n.name.slice(0, 4)}…` : n.name}
              </text>
            </g>
          ))}

          {/* 中心「我」 */}
          <g pointerEvents="none">
            <circle cx={g.center.x} cy={g.center.y} r={g.center.r} fill="url(#star-center)" opacity={0.92} />
            <text
              x={g.center.x}
              y={g.center.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none fill-white"
              fontSize={16}
              fontWeight={600}
            >
              我
            </text>
          </g>
        </svg>

        {/* hover 提示：HTML 覆盖层按 viewBox 百分比定位，随容器缩放 */}
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: `${(hovered.x / size) * 100}%`, top: `${(hovered.y / size) * 100}%` }}
          >
            <p className="font-semibold text-slate-100">
              {hovered.name}
              <span className="ml-1.5 font-normal text-slate-400">{hovered.group}</span>
            </p>
            <p className="mt-0.5 tabular-nums text-slate-400">
              亲密度 {hovered.intimacy} · 往来 {hovered.count} 次
            </p>
          </div>
        )}
      </div>

      {/* 分组图例 */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {g.legend.map((l) => (
          <span key={l.tag} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.tag}
            <span className="tabular-nums text-slate-500">{l.count}</span>
          </span>
        ))}
        <span className="text-[11px] text-slate-600">节点大小 = 亲密度 + 往来频率 · 点击节点看 TA 档案</span>
      </div>
    </div>
  );
}
