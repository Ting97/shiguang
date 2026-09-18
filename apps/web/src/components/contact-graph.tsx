"use client";

/**
 * 星型关系图谱 —— 手写 SVG 渲染，布局在 lib/graph.ts（纯函数+单测）
 * 我为中心：五档重要程度轨道（亲密最近、简单最远），颜色=分组，节点大小=亲密度+互动频率
 * 节点可拖动（Pointer Events，6px 阈值区分点击与拖动；拖动为临时位置，筛选/刷新后恢复）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildStarGraph, type GraphContact, type GraphNode } from "@/lib/graph";

type Override = Map<string, { x: number; y: number }>;

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
  const [overrides, setOverrides] = useState<Override>(new Map());
  // 拖动进行时状态用 ref 存，避免高频 re-render 抖动
  const drag = useRef<{ id: string; startClient: { x: number; y: number }; origin: { x: number; y: number }; moved: boolean } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(320, Math.min(560, el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => buildStarGraph(contacts, size), [contacts, size]);

  // 布局重算（筛选/数据/尺寸变化）后清空拖动覆盖，恢复自动布局
  useEffect(() => {
    setOverrides(new Map());
  }, [contacts, size]);

  /** 节点最终坐标 = 自动布局 + 拖动覆盖 */
  const posOf = (n: GraphNode) => overrides.get(n.id) ?? { x: n.x, y: n.y };

  function onPointerDown(e: React.PointerEvent, n: GraphNode) {
    if (drag.current) return;
    const p = posOf(n);
    drag.current = { id: n.id, startClient: { x: e.clientX, y: e.clientY }, origin: p, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const svgRect = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
    const scale = size / svgRect.width;
    const dx = (e.clientX - d.startClient.x) * scale;
    const dy = (e.clientY - d.startClient.y) * scale;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // 6px 阈值内仍是点击
    if (!d.moved) {
      d.moved = true;
      setDraggingId(d.id);
      setHover(null);
    }
    // 拖动时把指针位移换算成 SVG 坐标增量，钳制在画布内
    const x = Math.max(14, Math.min(size - 14, d.origin.x + dx));
    const y = Math.max(14, Math.min(size - 14, d.origin.y + dy));
    setOverrides((m) => new Map(m).set(d.id, { x, y }));
  }

  function onPointerUp(e: React.PointerEvent, n: GraphNode) {
    const d = drag.current;
    drag.current = null;
    setDraggingId(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (d && !d.moved) onOpen(n.id); // 未拖动 = 点击 → 进 TA 档案
  }

  const hovered = hover ? g.nodes.find((n) => n.id === hover) : null;
  const hoveredPos = hovered ? posOf(hovered) : null;

  return (
    <div>
      <div ref={wrapRef} className="relative">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block touch-none select-none"
          onPointerMove={onPointerMove}
        >
          <defs>
            <radialGradient id="star-center" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </radialGradient>
          </defs>

          {/* 五档重要程度轨道参考圈（外=简单 … 内=亲密）+ 档位标签 */}
          {g.rings.map((ring) => (
            <g key={ring.label} className="pointer-events-none">
              <circle
                cx={g.center.x}
                cy={g.center.y}
                r={ring.r}
                fill="none"
                stroke="rgba(148,163,184,0.14)"
                strokeDasharray="3 6"
              />
              <text
                x={g.center.x}
                y={g.center.y - ring.r - 4}
                textAnchor="middle"
                fontSize={10}
                className="fill-slate-500"
              >
                {ring.label}
              </text>
            </g>
          ))}

          {/* 中心 → 联系人 连线（端点跟随拖动） */}
          {g.edges.map((e, i) => {
            const n = g.nodes[i];
            const p = posOf(n);
            return (
              <line
                key={n.id}
                x1={g.center.x}
                y1={g.center.y}
                x2={p.x}
                y2={p.y}
                stroke={e.color}
                strokeWidth={1.5}
                opacity={e.opacity}
              />
            );
          })}

          {/* 联系人节点（可拖动） */}
          {g.nodes.map((n) => {
            const p = posOf(n);
            const isDragging = draggingId === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={isDragging ? "cursor-grabbing" : "cursor-grab"}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onPointerDown(e, n)}
                onPointerUp={(e) => onPointerUp(e, n)}
                onMouseEnter={() => !draggingId && setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                <circle
                  r={n.r}
                  fill={n.color}
                  fillOpacity={hover === n.id || isDragging ? 0.5 : 0.28}
                  stroke={n.color}
                  strokeWidth={hover === n.id || isDragging ? 2.5 : 1.5}
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
            );
          })}

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
        {hovered && hoveredPos && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: `${(hoveredPos.x / size) * 100}%`, top: `${(hoveredPos.y / size) * 100}%` }}
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
        <span className="text-[11px] text-slate-600">
          距离=重要程度 · 节点大小=亲密度+往来 · 拖动节点可摆位 · 点击看 TA 档案
        </span>
      </div>
    </div>
  );
}
