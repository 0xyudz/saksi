import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pino", "postgres", "@mysten-incubation/memwal"],
};

export default nextConfig;
