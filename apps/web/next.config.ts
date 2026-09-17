import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@shiguangri/ai"],
  devIndicators: false, // 隐藏左下角 Next.js 开发调试浮标（英文界面，正式部署本来也不显示）
};

export default nextConfig;
