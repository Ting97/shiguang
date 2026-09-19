import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@shiguangri/shared", "@shiguangri/ai"],
  devIndicators: false,
};

export default nextConfig;
