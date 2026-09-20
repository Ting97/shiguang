import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 远程加载模式：WebView 直接加载线上站点（与 API 同源，cookie 认证零改造）。
 * Capacitor 桥注入到 allowNavigation 白名单 origin——原生插件（后续加本地通知等）可用。
 */
const config: CapacitorConfig = {
  appId: "cn.ting97.shiguang",
  appName: "拾光",
  webDir: "www",
  server: {
    url: "https://shiguang.ting97.cn",
    cleartext: false,
    allowNavigation: ["shiguang.ting97.cn"],
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#020617",
  },
};

export default config;
