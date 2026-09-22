import type { Viewport } from "next";
import ChunkErrorReloader from "@/components/chunk-error-reloader";
import "./globals.css";

export const metadata = {
  title: "拾光",
  description: "拾起光阴，记录今日 —— 个人经营系统：钱 · 时间 · 人",
};

export const viewport: Viewport = {
  themeColor: "#020617", // 深色默认；防闪烁脚本与切换按钮会在运行时同步更新
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

/** 首帧前解析主题（防闪烁）：localStorage 记忆 → 未设置时跟随系统；同步 meta theme-color */
const themeScript = `(function(){try{var m=localStorage.getItem("shiguang_theme");if(m!=="dark"&&m!=="light")m="system";var l=m==="light"||(m==="system"&&window.matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark";var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",l?"#f1f5f9":"#020617")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased text-ink">
        <ChunkErrorReloader />
        {children}
      </body>
    </html>
  );
}
