import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pino", "postgres", "@mysten-incubation/memwal"],
  /**
   * `/docs/[slug]` renders the Markdown files in `docs/` at request time, so they have to be
   * traced into the deployment output. Without this the pages work locally and fail in
   * production with a missing file.
   */
  outputFileTracingIncludes: {
    "/docs/[slug]": ["./docs/**/*.md", "./README.md"],
  },
};

export default nextConfig;
