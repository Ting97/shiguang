"use client";

/**
 * 主题切换（导航栏入口）：深色 → 浅色 → 跟随系统 三态循环。
 * 首帧主题由 layout 内联脚本决定（防闪烁），本组件挂载后读 localStorage 对齐显示；
 * 「跟随系统」监听系统偏好变化实时重解析。
 */

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export const THEME_KEY = "shiguang_theme";
export type ThemeMode = "dark" | "light" | "system";

const ORDER: ThemeMode[] = ["dark", "light", "system"];
const META: Record<ThemeMode, string> = { dark: "#020617", light: "#f1f5f9", system: "#020617" };
const LABEL: Record<ThemeMode, string> = { dark: "深色", light: "浅色", system: "跟随系统" };
const ICON: Record<ThemeMode, typeof Moon> = { dark: Moon, light: Sun, system: Monitor };

function readMode(): ThemeMode {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
  return v === "dark" || v === "light" ? v : "system";
}

function resolve(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(mode: ThemeMode) {
  const resolved = resolve(mode);
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[resolved]);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(readMode());
    setMounted(true);
    // 「跟随系统」时系统偏好变化 → 实时重解析（用户手动选过深/浅则不受影响）
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (readMode() === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    localStorage.setItem(THEME_KEY, next);
    apply(next);
  };

  const Icon = mounted ? ICON[mode] : Moon; // 未挂载前固定图标，避免 hydration 不匹配
  return (
    <button
      onClick={cycle}
      title={`主题：${LABEL[mode]}（点击切换）`}
      aria-label={`切换主题，当前${LABEL[mode]}`}
      className="tap-lg shrink-0 rounded-full p-2 text-ink-mute transition hover:bg-wash hover:text-accent"
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
