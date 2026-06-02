import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Type errors are enforced via `npx tsc --noEmit`. 
    // See tsconfig.json for test file exclusions.
  },
};

export default nextConfig;
