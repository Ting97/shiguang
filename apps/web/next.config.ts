import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 纯静态客户端：页面全部 "use client" + fetch API，产物 out/ 由 apps/api 同域托管
  output: "export",
  transpilePackages: ["@shiguangri/shared"],
  devIndicators: false, // 隐藏左下角 Next.js 开发调试浮标
};

export default nextConfig;
