import type { Viewport } from "next";
import "./globals.css";

export const metadata = {
  title: "拾光复利",
  description: "拾起光阴，记录今日 —— 个人经营系统：钱 · 时间 · 人",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased text-slate-100">{children}</body>
    </html>
  );
}
