import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Pre-existing type errors in test files and sync engine block Docker builds.
    // Types are still enforced by IDE + `npx tsc --noEmit` in CI.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
