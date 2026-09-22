"use client";

/**
 * 星型关系图谱 —— 手写 SVG 渲染，布局在 lib/graph.ts（纯函数+单测）
 * 我为中心：五档重要程度轨道（亲密最近、简单最远），颜色=分组，节点大小=亲密度+互动频率
 * 节点可拖动（Pointer Events，6px 阈值区分点击与拖动；拖动为临时位置，筛选/刷新后恢复）
 * 3-G：滚轮/双指缩放（0.4~2.5，指针为锚）、空白拖拽平移、双击复位、+/−/⟲ 按钮；
 *      名字 label 描边衬底（不被连线穿过）、缩放 <0.6 隐藏、中心光晕、贝塞尔边+热度透明度、hover 高亮
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildStarGraph, type GraphContact, type GraphNode } from "@/lib/graph";

type Override = Map<string, { x: number; y: number }>;
interface View {
  scale: number;
  tx: number;
  ty: number;
}
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export default function ContactGraph({
  contacts,
  onOpen,
}: {
  contacts: GraphContact[];
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(640);
  const [hover, setHover] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Override>(new Map());
  const [view, setView] = useState<View>(IDENTITY);
  // 视图/拖动/双指的进行时状态用 ref 存，避免高频 re-render 抖动；viewRef 供原生 wheel 监听读最新值
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ id: string; startClient: { x: number; y: number }; origin: { x: number; y: number }; moved: boolean } | null>(null);
  const pan = useRef<{ startClient: { x: number; y: number }; startView: View } | null>(null);
  const pinch = useRef<{ dist: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
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

  /** 滚轮缩放：原生非被动监听才能 preventDefault；以指针为锚（锚点公式 tx' = px - (px-tx)*k） */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const k = size / rect.width; // client px → viewBox px
      const px = (e.clientX - rect.left) * k;
      const py = (e.clientY - rect.top) * k;
      setView((v) => {
        const next = clampScale(v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        const f = next / v.scale;
        return { scale: next, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [size]);

  const zoomBy = (factor: number) =>
    setView((v) => {
      const next = clampScale(v.scale * factor);
      const f = next / v.scale;
      const c = size / 2; // 按钮缩放以画布中心为锚
      return { scale: next, tx: c - (c - v.tx) * f, ty: c - (c - v.ty) * f };
    });
  const resetView = () => setView(IDENTITY);

  /** 客户端坐标 → viewBox 坐标 */
  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const k = size / rect.width;
    return { x: (clientX - rect.left) * k, y: (clientY - rect.top) * k };
  };

  /** 节点最终坐标 = 自动布局 + 拖动覆盖 */
  const posOf = (n: GraphNode) => overrides.get(n.id) ?? { x: n.x, y: n.y };

  function onNodePointerDown(e: React.PointerEvent, n: GraphNode) {
    if (drag.current || pinch.current) return;
    e.stopPropagation(); // 节点事件不触发背景平移
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = posOf(n);
    drag.current = { id: n.id, startClient: { x: e.clientX, y: e.clientY }, origin: p, moved: false };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // 合成事件/pointerId 失效时捕获失败可忽略，不应阻断点击导航
    }
  }

  function onSvgPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // 双指进入：中止拖动/平移，进入捏合
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag.current = null;
      pan.current = null;
      setDraggingId(null);
      return;
    }
    if (drag.current) return;
    pan.current = { startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // 捕获失败不影响平移（指针移出画布丢一次 move 而已）
    }
  }

  function onSvgPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指捏合：距离比 → 缩放（锚=中点），中点位移 → 平移
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = toSvg(mid.x, mid.y);
      setView((v) => {
        if (pinch.current!.dist <= 0) return v;
        const next = clampScale(v.scale * (dist / pinch.current!.dist));
        const f = next / v.scale;
        return { scale: next, tx: p.x - (p.x - v.tx) * f, ty: p.y - (p.y - v.ty) * f };
      });
      pinch.current = { dist };
      return;
    }

    // 背景平移
    const pn = pan.current;
    if (pn) {
      const rect = svgRef.current!.getBoundingClientRect();
      const k = size / rect.width;
      setView({
        scale: pn.startView.scale,
        tx: pn.startView.tx + (e.clientX - pn.startClient.x) * k,
        ty: pn.startView.ty + (e.clientY - pn.startClient.y) * k,
      });
      return;
    }

    // 节点拖动（位移换算除以视图缩放）
    const d = drag.current;
    if (!d) return;
    const v = viewRef.current;
    const scale = size / svgRef.current!.getBoundingClientRect().width;
    const dx = ((e.clientX - d.startClient.x) * scale) / v.scale;
    const dy = ((e.clientY - d.startClient.y) * scale) / v.scale;
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

  function endPointer(e: React.PointerEvent, n?: GraphNode) {
    pointers.current.delete(e.pointerId);
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      // 捕获释放失败不应阻断点击导航
    }
    if (pinch.current && pointers.current.size < 2) pinch.current = null;
    const pn = pan.current;
    if (pn && !pointers.current.size) {
      pan.current = null;
      return;
    }
    const d = drag.current;
    if (d && n) {
      drag.current = null;
      setDraggingId(null);
      if (!d.moved) onOpen(n.id); // 未拖动 = 点击 → 进 TA 档案
    }
  }

  const hovered = hover ? g.nodes.find((n) => n.id === hover) : null;
  const hoveredPos = hovered ? posOf(hovered) : null;
  const showLabels = view.scale >= 0.6;

  return (
    <div>
      <div ref={wrapRef} className="relative">
        <svg
          ref={svgRef}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block touch-none select-none"
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={(e) => endPointer(e)}
          onPointerCancel={(e) => endPointer(e)}
          onDoubleClick={resetView}
          style={{ cursor: pan.current ? "grabbing" : "default" }}
        >
          <defs>
            <radialGradient id="star-center" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </radialGradient>
            <radialGradient id="star-glow">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
              <stop offset="70%" stopColor="#6366f1" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </radialGradient>
          </defs>

          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {/* 五档重要程度轨道参考圈（外=简单 … 内=亲密）+ 档位标签（衬底防叠线） */}
            {g.rings.map((ring) => (
              <g key={ring.label} className="pointer-events-none">
                <circle
                  cx={g.center.x}
                  cy={g.center.y}
                  r={ring.r}
                  fill="none"
                  stroke="var(--orbit)"
                  strokeDasharray="3 6"
                />
                <text
                  x={g.center.x}
                  y={g.center.y - ring.r - 4}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-ink-dim"
                  stroke="var(--surface)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                >
                  {ring.label}
                </text>
              </g>
            ))}

            {/* 中心光晕 */}
            <circle
              cx={g.center.x}
              cy={g.center.y}
              r={g.center.r + 18}
              fill="url(#star-glow)"
              className="pointer-events-none"
            />

            {/* 中心 → 联系人 连线：二次贝塞尔轻度弧度，互动热度→不透明度；hover 高亮本节点边、其余淡出 */}
            {g.edges.map((e, i) => {
              const n = g.nodes[i];
              const p = posOf(n);
              const mx = (g.center.x + p.x) / 2;
              const my = (g.center.y + p.y) / 2;
              const dx = p.x - g.center.x;
              const dy = p.y - g.center.y;
              const len = Math.hypot(dx, dy) || 1;
              const bend = len * 0.08 * (i % 2 === 0 ? 1 : -1);
              const qx = mx + (-dy / len) * bend;
              const qy = my + (dx / len) * bend;
              const isHot = hover === n.id || draggingId === n.id;
              const dimmed = hovered != null && !isHot;
              return (
                <path
                  key={n.id}
                  d={`M ${g.center.x} ${g.center.y} Q ${qx} ${qy} ${p.x} ${p.y}`}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={isHot ? 2.5 : 1.5}
                  opacity={dimmed ? e.opacity * 0.18 : isHot ? Math.min(0.9, e.opacity + 0.35) : e.opacity}
                  className="pointer-events-none transition-all duration-200"
                />
              );
            })}

            {/* 联系人节点（可拖动） */}
            {g.nodes.map((n) => {
              const p = posOf(n);
              const isDragging = draggingId === n.id;
              const dimmed = hover != null && hover !== n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className={isDragging ? "cursor-grabbing" : "cursor-grab"}
                  style={{ touchAction: "none", opacity: dimmed ? 0.35 : 1, transition: "opacity 200ms" }}
                  onPointerDown={(e) => onNodePointerDown(e, n)}
                  onPointerUp={(e) => endPointer(e, n)}
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
                  {showLabels && (
                    <text
                      y={n.labelDy}
                      textAnchor="middle"
                      className="pointer-events-none select-none fill-ink-soft"
                      fontSize={13}
                      stroke="var(--surface)"
                      strokeWidth={3.5}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {n.name.length > 5 ? `${n.name.slice(0, 4)}…` : n.name}
                    </text>
                  )}
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
          </g>
        </svg>

        {/* 缩放控制按钮 */}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          {[
            { label: "＋", title: "放大", fn: () => zoomBy(1.25) },
            { label: "−", title: "缩小", fn: () => zoomBy(1 / 1.25) },
            { label: "⟲", title: "复位视图", fn: resetView },
          ].map((b) => (
            <button
              key={b.title}
              title={b.title}
              onClick={b.fn}
              className="h-7 w-7 rounded-lg border border-line-soft bg-surface/85 text-xs text-ink-soft shadow-sm transition hover:border-sky-500/50 hover:text-accent"
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* hover 提示：HTML 覆盖层按 viewBox 百分比定位（计入视图变换），随容器缩放 */}
        {hovered && hoveredPos && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-xl"
            style={{
              left: `${((hoveredPos.x * view.scale + view.tx) / size) * 100}%`,
              top: `${((hoveredPos.y * view.scale + view.ty) / size) * 100}%`,
            }}
          >
            <p className="font-semibold text-ink">
              {hovered.name}
              <span className="ml-1.5 font-normal text-ink-mute">{hovered.group}</span>
            </p>
            <p className="mt-0.5 tabular-nums text-ink-mute">
              亲密度 {hovered.intimacy} · 往来 {hovered.count} 次
            </p>
          </div>
        )}
      </div>

      {/* 分组图例 */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {g.legend.map((l) => (
          <span key={l.tag} className="flex items-center gap-1.5 text-[11px] text-ink-mute">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.tag}
            <span className="tabular-nums text-ink-dim">{l.count}</span>
          </span>
        ))}
        <span className="text-[11px] text-ink-faint">
          距离=重要程度 · 滚轮/双指缩放 · 拖空白平移 · 双击复位 · 拖节点摆位 · 点击看 TA 档案
        </span>
      </div>
    </div>
  );
}
