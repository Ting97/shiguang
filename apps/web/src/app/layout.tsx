import "./globals.css";

export const metadata = {
  title: "拾光日",
  description: "拾起光阴，记录今日 —— 个人经营系统：钱 · 时间 · 人",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
