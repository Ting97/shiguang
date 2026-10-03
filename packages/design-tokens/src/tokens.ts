/**
 * 设计令牌单一真源（REQ-009 批次 9-A）。
 *
 * 三端消费方式：
 * - web      → scripts/generate.ts 生成 globals.css 的 TOKENS 块（:root + [data-theme="light"]）
 * - miniapp  → 同脚本生成 app.scss 的 page{} / .theme-light TOKENS 块 + theme.json（微信 darkmode）
 * - mobile   → 生成 generated/mobile-themes.js(.d.ts)，App.tsx import
 *
 * 规则：
 * - 色板值以 web globals.css 为基准；改任何值只改这里，然后 `npm run tokens` 重新生成，
 *   CI 跑 `npm run tokens:verify`，手改生成块会被拒绝。
 * - webOnlyVars 仅进 web（小程序无 hover/滚动条概念）；miniappExtraVars 仅进小程序
 *   （无 color-mix，需显式给 input-bg）。
 * - mobileThemes 全部从色板派生（withAlpha/alphaOf），不存在第二份手写数值。
 */

export type Palette = Record<string, string>;

/** 深色（默认主题）：与 web globals.css :root 逐值一致（9-A 零回归基准） */
export const dark: Palette = {
  bg: "#020617",
  surface: "#0f172a",
  elevated: "#1e293b",
  soft: "#334155",
  strong: "#475569",
  scrim: "#020617",
  wash: "rgba(255, 255, 255, 0.05)",
  ink: "#f1f5f9",
  "ink-soft": "#cbd5e1",
  "ink-mute": "#94a3b8",
  "ink-dim": "#64748b",
  "ink-faint": "#475569",
  "line-strong": "#475569",
  line: "#334155",
  "line-soft": "#1e293b",
  accent: "#7dd3fc",
  danger: "#fda4af",
  success: "#6ee7b7",
  warn: "#fcd34d",
  ai: "#d8b4fe",
  "glass-bg": "rgba(15, 23, 42, 0.55)",
  "glass-bg-mobile": "rgba(15, 23, 42, 0.88)",
  "glass-border": "rgba(148, 163, 184, 0.12)",
  "glass-highlight": "rgba(255, 255, 255, 0.04)",
  "glass-shadow": "rgba(2, 6, 23, 0.4)",
  "glass-hover-border": "rgba(148, 163, 184, 0.28)",
  "glass-hover-shadow": "rgba(2, 6, 23, 0.55)",
  "aurora-1": "rgba(56, 189, 248, 0.13)",
  "aurora-2": "rgba(129, 140, 248, 0.09)",
  "aurora-3": "rgba(244, 114, 182, 0.06)",
  "heat-0": "#1e293b",
  "heat-1": "#164e63",
  "heat-2": "#0e7490",
  "heat-3": "#0891b2",
  "heat-4": "#22d3ee",
  "chart-track": "#1e293b",
  orbit: "rgba(148, 163, 184, 0.14)",
  selection: "rgba(56, 189, 248, 0.35)",
  "scrollbar-thumb": "rgba(71, 85, 105, 0.5)",
  "scrollbar-thumb-hover": "rgba(100, 116, 139, 0.7)",
  "skeleton-1": "rgba(30, 41, 59, 0.6)",
  "skeleton-2": "rgba(51, 65, 85, 0.6)",
  "empty-border": "rgba(51, 65, 85, 0.9)",
  "ghost-bg": "rgba(15, 23, 42, 0.6)",
  "ghost-border": "rgba(255, 255, 255, 0.1)",
  "ghost-hover-border": "rgba(56, 189, 248, 0.5)",
  "ghost-hover-text": "#bae6fd",
  "input-focus-bg": "rgba(2, 6, 23, 0.6)",
  "text-gradient-1": "#f8fafc",
  "text-gradient-2": "#7dd3fc",
  "text-gradient-3": "#a5b4fc",
  "capture-btn": "#38bdf8",
};

/** 浅色主题：与 web globals.css [data-theme="light"] 逐值一致 */
export const light: Palette = {
  bg: "#f1f5f9",
  surface: "#ffffff",
  elevated: "#f1f5f9",
  soft: "#e2e8f0",
  strong: "#cbd5e1",
  scrim: "#64748b",
  wash: "rgba(15, 23, 42, 0.045)",
  ink: "#0f172a",
  "ink-soft": "#334155",
  "ink-mute": "#475569",
  "ink-dim": "#64748b",
  "ink-faint": "#94a3b8",
  "line-strong": "#cbd5e1",
  line: "#d3dbe4",
  "line-soft": "#e5eaf1",
  accent: "#0369a1",
  danger: "#be123c",
  success: "#047857",
  warn: "#b45309",
  ai: "#7e22ce",
  "glass-bg": "rgba(255, 255, 255, 0.72)",
  "glass-bg-mobile": "rgba(255, 255, 255, 0.95)",
  "glass-border": "rgba(15, 23, 42, 0.08)",
  "glass-highlight": "rgba(255, 255, 255, 0.6)",
  "glass-shadow": "rgba(15, 23, 42, 0.06)",
  "glass-hover-border": "rgba(15, 23, 42, 0.16)",
  "glass-hover-shadow": "rgba(15, 23, 42, 0.1)",
  "aurora-1": "rgba(56, 189, 248, 0.1)",
  "aurora-2": "rgba(99, 102, 241, 0.08)",
  "aurora-3": "rgba(244, 114, 182, 0.06)",
  "heat-0": "#e2e8f0",
  "heat-1": "#a5f3fc",
  "heat-2": "#67e8f9",
  "heat-3": "#22d3ee",
  "heat-4": "#0891b2",
  "chart-track": "#e2e8f0",
  orbit: "rgba(15, 23, 42, 0.08)",
  selection: "rgba(56, 189, 248, 0.22)",
  "scrollbar-thumb": "rgba(148, 163, 184, 0.6)",
  "scrollbar-thumb-hover": "rgba(100, 116, 139, 0.8)",
  "skeleton-1": "rgba(226, 232, 240, 0.7)",
  "skeleton-2": "rgba(203, 213, 225, 0.9)",
  "empty-border": "#cbd5e1",
  "ghost-bg": "rgba(255, 255, 255, 0.65)",
  "ghost-border": "rgba(15, 23, 42, 0.1)",
  "ghost-hover-border": "rgba(2, 132, 199, 0.5)",
  "ghost-hover-text": "#075985",
  "input-focus-bg": "rgba(255, 255, 255, 0.9)",
  "text-gradient-1": "#0f172a",
  "text-gradient-2": "#0369a1",
  "text-gradient-3": "#4338ca",
  "capture-btn": "#f7f1e3",
};

/** 仅 web 生成（小程序无 hover 态、无滚动条、无选区概念） */
export const webOnlyVars: ReadonlySet<string> = new Set([
  "selection",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "glass-hover-border",
  "glass-hover-shadow",
]);

/** 仅小程序生成的补充变量（无 color-mix，需显式给出 = Tailwind bg-surface/60 的合成值） */
export const miniappExtraVars: Record<"dark" | "light", Palette> = {
  dark: { "input-bg": "rgba(15, 23, 42, 0.6)" },
  light: { "input-bg": "rgba(255, 255, 255, 0.6)" },
};

/** 生成顺序与分组注释（校验：groups 必须恰好覆盖色板全部键） */
export const groups: Array<[string, string[]]> = [
  ["表面层", ["bg", "surface", "elevated", "soft", "strong", "scrim", "wash"]],
  ["文字层", ["ink", "ink-soft", "ink-mute", "ink-dim", "ink-faint"]],
  ["边框层", ["line-strong", "line", "line-soft"]],
  ["语义强调", ["accent", "danger", "success", "warn", "ai"]],
  ["玻璃卡片", ["glass-bg", "glass-bg-mobile", "glass-border", "glass-highlight", "glass-shadow", "glass-hover-border", "glass-hover-shadow"]],
  ["极光背景", ["aurora-1", "aurora-2", "aurora-3"]],
  ["图表", ["heat-0", "heat-1", "heat-2", "heat-3", "heat-4", "chart-track", "orbit"]],
  ["杂项", ["selection", "scrollbar-thumb", "scrollbar-thumb-hover", "skeleton-1", "skeleton-2", "empty-border", "ghost-bg", "ghost-border", "ghost-hover-border", "ghost-hover-text", "input-focus-bg", "text-gradient-1", "text-gradient-2", "text-gradient-3"]],
  ["悬浮发布钮", ["capture-btn"]],
];

// ============ 排版 / 圆角 / 动效 / 层级（9-B 起在 web Tailwind 接线） ============

/** 正文字号刻度：全站收敛目标（消灭 9px；10px 仅徽标特例用 badge.micro） */
export const typeScale = { micro: 11, caption: 12, body: 13, title: 15, headline: 17, display: 20 } as const;
export const badge = { micro: 10 } as const;

/** 圆角刻度 */
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;

/** 动效刻度：统一 transition 时长与缓动（配合 prefers-reduced-motion 全局关停） */
export const motion = {
  fast: 150,
  base: 200,
  slow: 350,
  slower: 500,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/** 层级刻度：收编散布的 30~100 字面量与 z-[..] 任意值 */
export const zIndex = { base: 0, sticky: 20, overlay: 30, modal: 40, toast: 50, max: 60 } as const;

// ============ mobile（Expo）派生词汇表 ============

/** #rrggbb → rgba(r, g, b, a) */
function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** rgba(...) → 透明度（skia 极光只吃数值 alpha，颜色在组件内固定） */
function alphaOf(rgba: string): number {
  const m = rgba.match(/,\s*([\d.]+)\)$/);
  if (!m) throw new Error(`alphaOf: 无法解析 ${rgba}`);
  return Number(m[1]);
}

export interface MobileTheme {
  bg: string;
  surface: string;
  /** 半透明面板（=web bg-surface/70 合成值） */
  surfaceSoft: string;
  elevated: string;
  glassBorder: string;
  glassHighlight: string;
  line: string;
  lineSoft: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  accentBright: string;
  danger: string;
  dangerSolid: string;
  success: string;
  /** 大标题（=text-gradient-1） */
  title: string;
  /** 弹层遮罩（=web bg-scrim/70 实际合成值，RN 无 color-mix 需预合成） */
  scrim: string;
  /** 悬浮发布钮（=capture-btn） */
  fab: string;
  fabFg: string;
  bannerOkBg: string;
  bannerOkBorder: string;
  bannerErrBg: string;
  bannerErrBorder: string;
  chipWarn: string;
  blurTint: "light" | "dark";
  aurora: { sky: number; indigo: number; pink: number };
}

function toMobileTheme(p: Palette, blurTint: "light" | "dark"): MobileTheme {
  return {
    bg: p.bg,
    surface: p.surface,
    surfaceSoft: withAlpha(p.surface, 0.7),
    elevated: p.elevated,
    glassBorder: p["glass-border"],
    glassHighlight: p["glass-highlight"],
    line: p.line,
    lineSoft: p["line-soft"],
    ink: p.ink,
    inkSoft: p["ink-soft"],
    inkMute: p["ink-mute"],
    inkDim: p["ink-dim"],
    inkFaint: p["ink-faint"],
    accent: p.accent,
    accentBright: "#0ea5e9",
    danger: p.danger,
    dangerSolid: "#f43f5e",
    success: p.success,
    title: p["text-gradient-1"],
    scrim: withAlpha(p.scrim, 0.7),
    fab: p["capture-btn"],
    fabFg: blurTint === "dark" ? "#062033" : "#0f172a",
    bannerOkBg: "rgba(16, 185, 129, 0.1)",
    bannerOkBorder: "rgba(16, 185, 129, 0.3)",
    bannerErrBg: "rgba(244, 63, 94, 0.1)",
    bannerErrBorder: "rgba(244, 63, 94, 0.3)",
    chipWarn: p.warn,
    blurTint,
    aurora: { sky: alphaOf(p["aurora-1"]), indigo: alphaOf(p["aurora-2"]), pink: alphaOf(p["aurora-3"]) },
  };
}

/** Expo 端主题（生成 generated/mobile-themes.js 的源） */
export const mobileThemes: { dark: MobileTheme; light: MobileTheme } = {
  dark: toMobileTheme(dark, "dark"),
  light: toMobileTheme(light, "light"),
};
