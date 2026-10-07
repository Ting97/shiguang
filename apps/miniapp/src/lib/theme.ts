/**
 * 主题三态（对齐 web components/theme-toggle.tsx）：dark → light → system 循环。
 * 存储 key 与 web 同名（shiguang_theme），机制差异：web 用 data-theme 属性，
 * 小程序无根元素属性可选——浅色令牌挂在页面根 view 的 .theme-light 类上（见 app.scss）。
 * page 元素底色默认深色；切浅色时用 wx.setBackgroundColor 同步原生底，
 * 否则下拉/回弹露出的原生底仍是深色。
 */
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type Theme = "dark" | "light";
const KEY = "shiguang_theme";
const EVT = "theme:change";

export function getThemeMode(): ThemeMode {
  try {
    const v = Taro.getStorageSync(KEY);
    return v === "light" || v === "system" || v === "dark" ? v : "dark";
  } catch {
    return "dark";
  }
}

// getSystemInfoSync 是同步桥调用：system 模式下旧版每次 render 都调一次。
// 主题切换本身由微信 onThemeChange → 页面重渲染承接，短 TTL 缓存对正确性无损
let sysThemeCache: { theme: Theme; at: number } | null = null;

export function resolveTheme(mode: ThemeMode): Theme {
  if (mode !== "system") return mode;
  if (sysThemeCache && Date.now() - sysThemeCache.at < 30_000) return sysThemeCache.theme;
  try {
    const theme = Taro.getSystemInfoSync().theme === "light" ? "light" : "dark";
    sysThemeCache = { theme, at: Date.now() };
    return theme;
  } catch {
    return "dark";
  }
}

export function setThemeMode(mode: ThemeMode) {
  try {
    Taro.setStorageSync(KEY, mode);
  } catch {
    /* 存储失败不影响本次会话 */
  }
  Taro.eventCenter.trigger(EVT, mode);
  syncNativeBackground(resolveTheme(mode));
}

export function cycleThemeMode(): ThemeMode {
  const order: ThemeMode[] = ["dark", "light", "system"];
  const next = order[(order.indexOf(getThemeMode()) + 1) % order.length];
  setThemeMode(next);
  return next;
}

/** 原生页面底色跟随（自定义导航下导航栏无原生部分，仅页面背景需要同步） */
export function syncNativeBackground(theme: Theme) {
  try {
    const color = theme === "light" ? "#f1f5f9" : "#020617";
    Taro.setBackgroundColor({ backgroundColor: color });
    Taro.setBackgroundTextStyle({ textStyle: theme === "light" ? "light" : "dark" });
  } catch {
    /* 部分机型不支持，忽略 */
  }
}

/** 页面级订阅：返回当前解析后的主题与循环切换函数 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const theme = resolveTheme(mode);
  useEffect(() => {
    const handler = (m: ThemeMode) => setMode(m);
    Taro.eventCenter.on(EVT, handler);
    return () => {
      Taro.eventCenter.off(EVT, handler);
    };
  }, []);
  return { mode, theme, cycle: cycleThemeMode };
}
